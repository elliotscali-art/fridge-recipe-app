export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SPOONACULAR_API_KEY not set' });

  const { ingredients, mealType, query, cuisine, maxReadyTime, diet, number } = req.body;
  const limit = Math.min(number || 12, 18);

  const mealTypeMap = {
    Breakfast: 'breakfast',
    Lunch: 'main course,soup,salad',
    Dinner: 'main course',
    Snack: 'snack,appetizer',
  };
  const spoonacularType = mealType && mealType !== 'Surprise me' ? mealTypeMap[mealType] : null;

  var found = [];
  var totalResults = null;

  // ── Search mode (text query) ──
  if (query || (!ingredients?.length && (cuisine || diet || maxReadyTime))) {
    var params = new URLSearchParams({
      number: limit,
      addRecipeInformation: 'false',
      apiKey,
    });
    if (query) params.set('query', query);
    if (cuisine) params.set('cuisine', cuisine.toLowerCase());
    if (maxReadyTime) params.set('maxReadyTime', maxReadyTime);
    if (diet) params.set('diet', diet);
    if (spoonacularType) params.set('type', spoonacularType);

    const searchRes = await fetch('https://api.spoonacular.com/recipes/complexSearch?' + params);
    const searchData = await searchRes.json();
    if (!searchRes.ok) return res.status(500).json({ error: 'Spoonacular search failed', detail: searchData });
    found = searchData.results || [];
    totalResults = searchData.totalResults || null;

  // ── Ingredient scan mode ──
  } else if (ingredients?.length) {
    // Always use findByIngredients for ingredient matching — it returns usedIngredients + missedIngredients
    // Then optionally filter by meal type in a second step via complexSearch
    if (spoonacularType) {
      // complexSearch with includeIngredients + meal type filter
      var params2 = new URLSearchParams({
        includeIngredients: ingredients.join(','),
        type: spoonacularType,
        number: limit,
        sort: 'min-missing-ingredients',
        fillIngredients: 'true',
        addRecipeInformation: 'false',
        apiKey,
      });
      if (cuisine) params2.set('cuisine', cuisine.toLowerCase());
      const r2 = await fetch('https://api.spoonacular.com/recipes/complexSearch?' + params2);
      const d2 = await r2.json();
      if (!r2.ok) return res.status(500).json({ error: 'Spoonacular search failed', detail: d2 });
      found = d2.results || [];
      totalResults = d2.totalResults || null;
    } else {
      // findByIngredients — best for ingredient matching
      const r = await fetch(
        'https://api.spoonacular.com/recipes/findByIngredients?ingredients=' +
        encodeURIComponent(ingredients.join(',')) +
        '&number=' + limit + '&ranking=1&ignorePantry=true&apiKey=' + apiKey
      );
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'Spoonacular search failed', detail: d });
      found = Array.isArray(d) ? d : [];
      // Get total count separately
      const countRes = await fetch(
        'https://api.spoonacular.com/recipes/complexSearch?includeIngredients=' +
        encodeURIComponent(ingredients.join(',')) + '&number=1&apiKey=' + apiKey
      ).catch(() => null);
      if (countRes?.ok) {
        const countData = await countRes.json().catch(() => ({}));
        totalResults = countData.totalResults || null;
      }
    }
  } else {
    return res.status(400).json({ error: 'Provide ingredients or a search query' });
  }

  if (found.length === 0) return res.status(200).json({ recipes: [], totalResults });

  // Normalise ingredient name for fuzzy matching
  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }

  // Whether a recipe ingredient name is covered by the user's list
  function isUsed(recipeIngName, userNorms) {
    var n = normalise(recipeIngName);
    return userNorms.some(function(u) { return n.includes(u) || u.includes(n); });
  }

  var userNorms = (ingredients || []).map(normalise);

  // Fetch full recipe info in parallel (max 12 at once)
  const recipes = await Promise.all(found.map(async function(r) {
    const infoRes = await fetch(
      'https://api.spoonacular.com/recipes/' + r.id + '/information?includeNutrition=false&apiKey=' + apiKey
    );
    const info = await infoRes.json();

    // Steps
    var steps = ((info.analyzedInstructions || [])[0]?.steps || []).map(function(s) {
      return { stepNumber: s.number, instruction: s.step };
    });

    // Cuisine
    var cuisineVal = (info.cuisines && info.cuisines[0]) || null;
    if (cuisineVal) cuisineVal = cuisineVal.charAt(0).toUpperCase() + cuisineVal.slice(1);

    // Description
    var rawSummary = (info.summary || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    var description = rawSummary.length > 220 ? rawSummary.slice(0, 220) + '…' : rawSummary;

    // Time
    var totalMins = info.readyInMinutes || null;
    var prepTime = info.preparationMinutes > 0 ? info.preparationMinutes + ' min' : null;
    var cookTime = info.cookingMinutes > 0 ? info.cookingMinutes + ' min' : null;
    if (!prepTime && !cookTime && totalMins) {
      prepTime = Math.round(totalMins * 0.35) + ' min';
      cookTime = Math.round(totalMins * 0.65) + ' min';
    }

    // Image
    var image = r.image || info.image || null;
    if (image && !image.startsWith('http')) image = 'https://spoonacular.com/recipeImages/' + image;

    // Difficulty
    var difficulty = totalMins <= 20 ? 'Easy' : totalMins <= 45 ? 'Medium' : 'Advanced';

    // Stars: spoonacularScore is 0–100; convert to 1–5 half-star precision
    var score = info.spoonacularScore ? Math.round(info.spoonacularScore) : null;
    var stars = score ? Math.round((score / 20) * 2) / 2 : null; // e.g. 80 → 4.0

    // Ingredient matching
    var usedIng, missingIng;
    if (r.usedIngredients && r.missedIngredients) {
      // findByIngredients path — trust the API
      usedIng = r.usedIngredients.map(function(i) { return i.name; });
      missingIng = r.missedIngredients.map(function(i) { return i.name; });
    } else {
      // complexSearch path — compute from extendedIngredients using fuzzy match
      var extIngs = (info.extendedIngredients || []).map(function(i) { return i.name || i.originalName || ''; });
      if (userNorms.length) {
        usedIng = extIngs.filter(function(n) { return isUsed(n, userNorms); });
        missingIng = extIngs.filter(function(n) { return !isUsed(n, userNorms); });
      } else {
        usedIng = [];
        missingIng = extIngs;
      }
    }

    return {
      id: r.id,
      title: info.title || r.title,
      description,
      cuisine: cuisineVal,
      prepTime: prepTime || '—',
      cookTime: cookTime || '—',
      totalTimeMinutes: totalMins,
      servings: info.servings || 2,
      difficulty,
      image,
      score,
      stars,
      usedIngredients: usedIng,
      missingIngredients: missingIng,
      steps,
    };
  }));

  res.status(200).json({ recipes, totalResults });
}

export const config = { api: { bodyParser: true } };
