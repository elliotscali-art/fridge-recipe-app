export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SPOONACULAR_API_KEY not set' });

  const { ingredients, mealType, query, cuisine, maxReadyTime, diet, number } = req.body;
  const limit = Math.min(number || 12, 18);

  const mealTypeMap = { Breakfast: 'breakfast', Lunch: 'main course,soup,salad', Dinner: 'main course', Snack: 'snack,appetizer' };
  const spoonacularType = mealType && mealTypeMap[mealType];

  var found = [];

  // ── Search mode (text query or filters, no ingredient list required) ──
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
    found = (searchData.results || []);

  // ── Ingredient scan mode ──
  } else if (ingredients?.length) {
    if (spoonacularType) {
      var params2 = new URLSearchParams({
        includeIngredients: ingredients.join(','),
        type: spoonacularType,
        number: limit,
        sort: 'min-missing-ingredients',
        addRecipeInformation: 'false',
        apiKey,
      });
      if (cuisine) params2.set('cuisine', cuisine.toLowerCase());
      const r = await fetch('https://api.spoonacular.com/recipes/complexSearch?' + params2);
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'Spoonacular search failed', detail: d });
      found = d.results || [];
    } else {
      const r = await fetch(
        'https://api.spoonacular.com/recipes/findByIngredients?ingredients=' +
        encodeURIComponent(ingredients.join(',')) +
        '&number=' + limit + '&ranking=2&ignorePantry=true&apiKey=' + apiKey
      );
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'Spoonacular search failed', detail: d });
      found = Array.isArray(d) ? d : [];
    }
  } else {
    return res.status(400).json({ error: 'Provide ingredients or a search query' });
  }

  if (found.length === 0) return res.status(200).json({ recipes: [] });

  // Fetch full details in parallel
  const recipes = await Promise.all(found.map(async function(r) {
    const infoRes = await fetch('https://api.spoonacular.com/recipes/' + r.id + '/information?apiKey=' + apiKey);
    const info = await infoRes.json();

    var steps = ((info.analyzedInstructions || [])[0]?.steps || []).map(function(s) {
      return { stepNumber: s.number, instruction: s.step };
    });

    var cuisine = (info.cuisines && info.cuisines[0]) || null;
    if (cuisine) cuisine = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);

    var rawSummary = (info.summary || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    var description = rawSummary.length > 220 ? rawSummary.slice(0, 220) + '…' : rawSummary;

    var prepTime = info.preparationMinutes > 0 ? info.preparationMinutes + ' min' : null;
    var cookTime = info.cookingMinutes > 0 ? info.cookingMinutes + ' min' : null;
    if (!prepTime && !cookTime && info.readyInMinutes) {
      prepTime = Math.round(info.readyInMinutes * 0.35) + ' min';
      cookTime = Math.round(info.readyInMinutes * 0.65) + ' min';
    }

    var image = r.image || info.image || null;
    if (image && !image.startsWith('http')) image = 'https://spoonacular.com/recipeImages/' + image;

    return {
      title: info.title || r.title,
      description,
      cuisine,
      prepTime: prepTime || '—',
      cookTime: cookTime || '—',
      totalTimeMinutes: info.readyInMinutes || null,
      servings: info.servings || 2,
      difficulty: info.readyInMinutes <= 20 ? 'Easy' : info.readyInMinutes <= 45 ? 'Medium' : 'Advanced',
      sourceUrl: info.sourceUrl || null,
      sourceName: info.sourceName || null,
      image,
      score: info.spoonacularScore ? Math.round(info.spoonacularScore) : null,
      usedIngredients: (r.usedIngredients || []).map(function(i) { return i.name; }),
      missingIngredients: (r.missedIngredients || []).map(function(i) { return i.name; }),
      steps,
    };
  }));

  res.status(200).json({ recipes });
}

export const config = { api: { bodyParser: true } };
