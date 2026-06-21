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

  // Helper
  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }
  function isUsed(recipeIngName, userNorms) {
    var n = normalise(recipeIngName);
    return userNorms.some(function(u) { return u && (n.includes(u) || u.includes(n)); });
  }
  var userNorms = (ingredients || []).map(normalise).filter(Boolean);

  // ── Build a single complexSearch request — addRecipeInformation+fillIngredients
  // returns everything in ONE API call instead of N+1
  var params = new URLSearchParams({
    number: limit,
    addRecipeInformation: 'true',
    fillIngredients: 'true',
    addRecipeNutrition: 'false',
    apiKey,
  });

  if (query) {
    params.set('query', query);
  } else if (ingredients && ingredients.length) {
    params.set('includeIngredients', ingredients.join(','));
    params.set('sort', 'min-missing-ingredients');
  } else if (!cuisine && !diet && !maxReadyTime) {
    return res.status(400).json({ error: 'Provide ingredients or a search query' });
  }

  if (spoonacularType) params.set('type', spoonacularType);
  if (cuisine) params.set('cuisine', cuisine.toLowerCase());
  if (maxReadyTime) params.set('maxReadyTime', maxReadyTime);
  if (diet) params.set('diet', diet);

  const searchRes = await fetch('https://api.spoonacular.com/recipes/complexSearch?' + params);
  const searchData = await searchRes.json();

  if (!searchRes.ok) {
    return res.status(500).json({
      error: 'Spoonacular search failed',
      detail: searchData.message || searchData.status || JSON.stringify(searchData).slice(0, 200),
    });
  }

  const found = searchData.results || [];
  if (found.length === 0) return res.status(200).json({ recipes: [] });

  // Map each result — all info is already embedded via addRecipeInformation
  const recipes = found.map(function(r) {
    // Steps
    var steps = ((r.analyzedInstructions || [])[0]?.steps || []).map(function(s) {
      return { stepNumber: s.number, instruction: s.step };
    });

    // Cuisine
    var cuisineVal = (r.cuisines && r.cuisines[0]) || null;
    if (cuisineVal) cuisineVal = cuisineVal.charAt(0).toUpperCase() + cuisineVal.slice(1);

    // Description
    var rawSummary = (r.summary || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    var description = rawSummary.length > 220 ? rawSummary.slice(0, 220) + '…' : rawSummary;

    // Time
    var totalMins = r.readyInMinutes || null;
    var prepTime = r.preparationMinutes > 0 ? r.preparationMinutes + ' min' : null;
    var cookTime = r.cookingMinutes > 0 ? r.cookingMinutes + ' min' : null;
    if (!prepTime && !cookTime && totalMins) {
      prepTime = Math.round(totalMins * 0.35) + ' min';
      cookTime = Math.round(totalMins * 0.65) + ' min';
    }

    // Image
    var image = r.image || null;
    if (image && !image.startsWith('http')) image = 'https://spoonacular.com/recipeImages/' + image;

    // Difficulty
    var difficulty = !totalMins || totalMins <= 20 ? 'Easy' : totalMins <= 45 ? 'Medium' : 'Advanced';

    // Stars
    var score = r.spoonacularScore ? Math.round(r.spoonacularScore) : null;
    var stars = score ? Math.round((score / 20) * 2) / 2 : null;

    // Ingredient matching
    // fillIngredients gives usedIngredients + missedIngredients when includeIngredients used
    var usedIng, missingIng;
    if (r.usedIngredients && r.missedIngredients) {
      usedIng = r.usedIngredients.map(function(i) { return i.name; });
      missingIng = r.missedIngredients.map(function(i) { return i.name; });
    } else {
      // Text search path — fuzzy match against extendedIngredients
      var extIngs = (r.extendedIngredients || []).map(function(i) { return i.name || i.originalName || ''; });
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
      title: r.title,
      description,
      cuisine: cuisineVal,
      prepTime: prepTime || '—',
      cookTime: cookTime || '—',
      totalTimeMinutes: totalMins,
      servings: r.servings || 2,
      difficulty,
      image,
      score,
      stars,
      usedIngredients: usedIng,
      missingIngredients: missingIng,
      steps,
    };
  });

  res.status(200).json({ recipes });
}

export const config = { api: { bodyParser: true } };
