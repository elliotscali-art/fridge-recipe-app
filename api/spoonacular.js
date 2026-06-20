export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'SPOONACULAR_API_KEY not set' });

  const { ingredients } = req.body;
  if (!ingredients || !ingredients.length) return res.status(400).json({ error: 'No ingredients provided' });

  // Step 1: find recipes that match the ingredients
  const findRes = await fetch(
    'https://api.spoonacular.com/recipes/findByIngredients' +
    '?ingredients=' + encodeURIComponent(ingredients.join(',')) +
    '&number=6&ranking=2&ignorePantry=true&apiKey=' + apiKey
  );
  const found = await findRes.json();

  if (!findRes.ok || !Array.isArray(found)) {
    return res.status(500).json({ error: 'Spoonacular search failed', detail: found });
  }

  if (found.length === 0) {
    return res.status(200).json({ recipes: [] });
  }

  // Step 2: fetch full details for each recipe in parallel
  const recipes = await Promise.all(found.map(async function(r) {
    const infoRes = await fetch(
      'https://api.spoonacular.com/recipes/' + r.id + '/information?apiKey=' + apiKey
    );
    const info = await infoRes.json();

    var steps = ((info.analyzedInstructions || [])[0]?.steps || []).map(function(s) {
      return { stepNumber: s.number, instruction: s.step };
    });

    var cuisine = (info.cuisines && info.cuisines[0]) || (info.dishTypes && info.dishTypes[0]) || null;
    if (cuisine) cuisine = cuisine.charAt(0).toUpperCase() + cuisine.slice(1);

    var rawSummary = (info.summary || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    var description = rawSummary.length > 220 ? rawSummary.slice(0, 220) + '…' : rawSummary;

    var prepTime = info.preparationMinutes > 0 ? info.preparationMinutes + ' min' : null;
    var cookTime = info.cookingMinutes > 0 ? info.cookingMinutes + ' min' : null;
    if (!prepTime && !cookTime && info.readyInMinutes) {
      prepTime = Math.round(info.readyInMinutes * 0.35) + ' min';
      cookTime = Math.round(info.readyInMinutes * 0.65) + ' min';
    }

    return {
      title: r.title,
      description,
      cuisine,
      prepTime: prepTime || '—',
      cookTime: cookTime || '—',
      totalTimeMinutes: info.readyInMinutes || null,
      servings: info.servings || 2,
      difficulty: info.readyInMinutes <= 20 ? 'Easy' : info.readyInMinutes <= 45 ? 'Medium' : 'Advanced',
      sourceUrl: info.sourceUrl || null,
      sourceName: info.sourceName || null,
      image: r.image || null,
      score: info.spoonacularScore ? Math.round(info.spoonacularScore) : null,
      usedIngredients: (r.usedIngredients || []).map(function(i) { return i.name; }),
      missingIngredients: (r.missedIngredients || []).map(function(i) { return i.name; }),
      steps,
    };
  }));

  res.status(200).json({ recipes });
}

export const config = { api: { bodyParser: true } };
