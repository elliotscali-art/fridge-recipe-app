import { useState, useRef, useCallback } from "react";

const THERMOMIX_SYSTEM_PROMPT = `You are a professional Thermomix chef and recipe developer. Your job is to:
1. Analyse a list of fridge ingredients provided by the user
2. Suggest 3 delicious recipes that use primarily those ingredients
3. Format each recipe in proper Thermomix cooking style

For each recipe, return ONLY a JSON array (no markdown, no backticks, no preamble) with this exact structure:
[
  {
    "title": "Recipe Name",
    "description": "One sentence description",
    "prepTime": "10 min",
    "cookTime": "25 min",
    "servings": 4,
    "difficulty": "Easy|Medium|Hard",
    "missingIngredients": ["ingredient1", "ingredient2"],
    "usedIngredients": ["ingredient1", "ingredient2"],
    "steps": [
      {
        "stepNumber": 1,
        "instruction": "Add onion and garlic to bowl.",
        "speed": "Speed 5",
        "temp": null,
        "time": null,
        "note": null
      }
    ]
  }
]
Use proper Thermomix terminology: Speed 1–10, Reverse, Varoma, 37°C/50°C/80°C/90°C/100°C/Varoma, Turbo. Always output pure JSON only.`;

const VISION_SYSTEM_PROMPT = `You are an expert at identifying food ingredients from images.
Analyse the image and list every food ingredient you can see. Be specific:
- Include quantities if visible (e.g. "half a block of parmesan", "3 eggs")
- Note the state if relevant (e.g. "leftover cooked chicken", "wilting spinach")
- Include condiments, sauces, dairy, vegetables, meats, leftovers
Return ONLY a JSON object (no markdown, no backticks) in this format:
{"ingredients": ["ingredient 1", "ingredient 2"], "notes": "Any observation about the fridge"}`;

async function callClaude(messages, systemPrompt) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompt,
      messages,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

function parseJSON(text) {
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

const Dots = () => (
  <span style={{ display: "inline-flex", gap: 2 }}>
    {[0, 1, 2].map(i => (
      <span key={i} style={{
        width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block",
        animation: "dot 1.2s infinite", animationDelay: `${i * 0.2}s`, opacity: 0
      }} />
    ))}
  </span>
);

export default function App() {
  const [stage, setStage] = useState("upload");
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [newIngredient, setNewIngredient] = useState("");
  const [recipes, setRecipes] = useState([]);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [error, setError] = useState(null);
  const [scanNotes, setScanNotes] = useState("");
  const fileRef = useRef();

  const resizeToJpeg = useCallback((file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1568;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error("Conversion failed"));
        const reader = new FileReader();
        reader.onload = e => { URL.revokeObjectURL(url); resolve(e.target.result); };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.88);
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = url;
  }), []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) return;
    setError(null);
    try {
      const dataUrl = await resizeToJpeg(file);
      setImageData(dataUrl.split(",")[1]);
      setImagePreview(dataUrl);
    } catch {
      setError("Couldn't read that image — try a JPG or PNG.");
    }
  }, [resizeToJpeg]);

  const scanImage = async () => {
    if (!imageData) return;
    setStage("scanning"); setError(null);
    try {
      const result = await callClaude([{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
        { type: "text", text: "Identify all the food ingredients in this fridge image." }
      ]}], VISION_SYSTEM_PROMPT);
      const parsed = parseJSON(result);
      setIngredients(parsed.ingredients || []);
      setScanNotes(parsed.notes || "");
      setStage("ingredients");
    } catch (err) {
      setError(`Scan failed: ${err.message}`);
      setStage("upload");
    }
  };

  const generateRecipes = async () => {
    setStage("generating"); setError(null);
    try {
      const result = await callClaude([{ role: "user",
        content: `My fridge contains: ${ingredients.join(", ")}. Suggest 3 Thermomix recipes.`
      }], THERMOMIX_SYSTEM_PROMPT);
      setRecipes(parseJSON(result));
      setStage("results");
    } catch (err) {
      setError(`Failed: ${err.message}`);
      setStage("ingredients");
    }
  };

  const addIngredient = () => {
    if (newIngredient.trim()) { setIngredients(p => [...p, newIngredient.trim()]); setNewIngredient(""); }
  };

  const reset = () => {
    setStage("upload"); setImageData(null); setImagePreview(null);
    setIngredients([]); setRecipes([]); setSelectedRecipe(null); setError(null);
  };

  const S = styles;

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Mono:wght@300;400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        body { background: #FAFAF7; font-family: 'DM Mono', monospace; }
        @keyframes dot { 0%,80%,100%{opacity:0} 40%{opacity:1} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        input { -webkit-appearance: none; border-radius: 0; }
      `}</style>

      {/* Header */}
      <div style={S.header}>
        <div style={S.eyebrow}>AI Kitchen Assistant</div>
        <h1 style={S.h1}>Fridge to <em style={{ color: "#C8552A", fontStyle: "italic" }}>Thermomix</em></h1>
      </div>

      {/* Progress */}
      <div style={S.progress}>
        {["Photo", "Ingredients", "Recipes"].map((label, i) => {
          const stageIdx = { upload: 0, scanning: 0, ingredients: 1, generating: 1, results: 2 }[stage] ?? 0;
          const active = stageIdx === i, done = stageIdx > i;
          return (
            <div key={label} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: done ? "#3D6B4A" : active ? "#C8552A" : "#E0DAD0" }} />
                <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: done ? "#3D6B4A" : active ? "#C8552A" : "#C0BAB0" }}>{label}</span>
              </div>
              {i < 2 && <div style={{ width: 40, height: 1, background: "#E0DAD0", margin: "0 8px", marginBottom: 16 }} />}
            </div>
          );
        })}
      </div>

      <div style={S.content}>
        {error && <div style={S.errorBox}>⚠ {error}</div>}

        {/* UPLOAD */}
        {stage === "upload" && (
          <div style={S.card}>
            <div style={S.cardTitle}>Upload your fridge photo</div>
            <div style={S.cardSub}>JPG, PNG, or HEIC from your iPhone camera roll</div>

            <div
              style={{ ...S.dropZone, ...(imagePreview ? S.dropZoneActive : {}) }}
              onClick={() => fileRef.current.click()}
            >
              {imagePreview ? (
                <img src={imagePreview} alt="Fridge" style={S.preview} />
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 300, marginBottom: 6 }}>Tap to choose photo</div>
                  <div style={{ fontSize: 11, color: "#9A9A92", letterSpacing: "0.06em" }}>or drag and drop</div>
                </div>
              )}
            </div>

            {imagePreview && (
              <button style={S.changeBtn} onClick={() => fileRef.current.click()}>↑ Change photo</button>
            )}

            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" style={{ display: "none" }}
              onChange={e => handleFile(e.target.files[0])} />

            <div style={S.btnRow}>
              <button style={{ ...S.btn, ...S.btnPrimary, ...(imageData ? {} : S.btnDisabled) }}
                onClick={scanImage} disabled={!imageData}>
                Scan ingredients →
              </button>
              <button style={{ ...S.btn, ...S.btnOutline }} onClick={() => setStage("ingredients")}>
                Type manually
              </button>
            </div>
          </div>
        )}

        {/* SCANNING */}
        {(stage === "scanning" || stage === "generating") && (
          <div style={{ ...S.card, textAlign: "center", padding: "60px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 20, animation: "pulse 2s ease-in-out infinite" }}>
              {stage === "scanning" ? "🔍" : "👨‍🍳"}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 300, marginBottom: 8 }}>
              {stage === "scanning" ? "Scanning your fridge" : "Creating recipes"} <Dots />
            </div>
            <div style={{ fontSize: 11, color: "#9A9A92", letterSpacing: "0.06em" }}>
              {stage === "scanning" ? "Identifying ingredients with AI vision" : "Crafting Thermomix-formatted recipes"}
            </div>
          </div>
        )}

        {/* INGREDIENTS */}
        {stage === "ingredients" && (
          <div style={S.card}>
            <button style={S.backLink} onClick={reset}>← Start over</button>
            <div style={S.cardTitle}>Your ingredients</div>
            <div style={S.cardSub}>{ingredients.length > 0 ? `${ingredients.length} found — edit as needed` : "Add ingredients below"}</div>

            {scanNotes && <div style={S.noteBox}>💡 {scanNotes}</div>}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20, minHeight: 40 }}>
              {ingredients.map((ing, i) => (
                <div key={i} style={S.tag}>
                  {ing}
                  <button onClick={() => setIngredients(p => p.filter((_, j) => j !== i))} style={S.tagX}>×</button>
                </div>
              ))}
              {ingredients.length === 0 && <span style={{ fontSize: 12, color: "#9A9A92", fontStyle: "italic" }}>No ingredients yet…</span>}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input style={S.input} placeholder="Add an ingredient…" value={newIngredient}
                onChange={e => setNewIngredient(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addIngredient()} />
              <button style={{ ...S.btn, ...S.btnOutline, padding: "0 18px" }} onClick={addIngredient}>Add</button>
            </div>

            <div style={S.btnRow}>
              <button style={{ ...S.btn, ...S.btnPrimary, ...(ingredients.length < 2 ? S.btnDisabled : {}) }}
                onClick={generateRecipes} disabled={ingredients.length < 2}>
                Find Thermomix recipes →
              </button>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {stage === "results" && (
          <>
            <button style={S.backLink} onClick={() => setStage("ingredients")}>← Edit ingredients</button>
            <div style={{ marginBottom: 16 }}>
              <div style={S.cardTitle}>Your recipes</div>
              <div style={S.cardSub}>Tap a recipe to see full Thermomix instructions</div>
            </div>

            {recipes.map((recipe, i) => {
              const total = (recipe.usedIngredients?.length || 0) + (recipe.missingIngredients?.length || 0);
              const pct = total > 0 ? Math.round((recipe.usedIngredients?.length || 0) / total * 100) : 100;
              const open = selectedRecipe === i;
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ ...S.recipeCard, ...(open ? S.recipeCardOpen : {}) }}
                    onClick={() => setSelectedRecipe(open ? null : i)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 400, lineHeight: 1.2 }}>{recipe.title}</div>
                      <div style={S.difficultyBadge}>{recipe.difficulty}</div>
                    </div>
                    <div style={{ fontSize: 12, color: "#5A5A54", lineHeight: 1.6, marginBottom: 12 }}>{recipe.description}</div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                      {[["⏱", recipe.prepTime], ["🔥", recipe.cookTime], ["👥", recipe.servings + " serves"]].map(([icon, val]) => (
                        <span key={icon} style={{ fontSize: 11, color: "#9A9A92" }}>{icon} <span style={{ color: "#1C1C1A" }}>{val}</span></span>
                      ))}
                      {recipe.missingIngredients?.length > 0 && (
                        <span style={{ fontSize: 11, color: "#C8552A" }}>Missing {recipe.missingIngredients.length} items</span>
                      )}
                    </div>
                    <div style={{ height: 2, background: "#E0DAD0", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#3D6B4A" }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#3D6B4A", marginTop: 5, letterSpacing: "0.06em" }}>{pct}% ingredient match</div>
                  </div>

                  {open && (
                    <div style={S.detailCard}>
                      {/* Ingredient boxes */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
                        <div style={{ ...S.ingBox, borderLeft: "2px solid #3D6B4A" }}>
                          <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#3D6B4A", marginBottom: 8 }}>✓ You have</div>
                          {(recipe.usedIngredients || []).map((ing, j) => <div key={j} style={{ fontSize: 12, marginBottom: 4 }}>{ing}</div>)}
                        </div>
                        {recipe.missingIngredients?.length > 0 && (
                          <div style={{ ...S.ingBox, borderLeft: "2px solid #C8552A" }}>
                            <div style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: "#C8552A", marginBottom: 8 }}>+ You need</div>
                            {recipe.missingIngredients.map((ing, j) => <div key={j} style={{ fontSize: 12, marginBottom: 4 }}>{ing}</div>)}
                          </div>
                        )}
                      </div>

                      {/* Steps */}
                      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 400, marginBottom: 16 }}>Thermomix Method</div>
                      {(recipe.steps || []).map((step, j) => (
                        <div key={j} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 12, marginBottom: 18, paddingBottom: 18, borderBottom: j < recipe.steps.length - 1 ? "1px solid #E0DAD0" : "none" }}>
                          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 300, color: "#D0CAC0", lineHeight: 1 }}>{step.stepNumber}</div>
                          <div>
                            <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{step.instruction}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {step.speed && <span style={{ ...S.chip, background: "#EBF0EB", color: "#3D6B4A" }}>{step.speed}</span>}
                              {step.temp && <span style={{ ...S.chip, background: "#F5EBE8", color: "#C8552A" }}>{step.temp}</span>}
                              {step.time && <span style={{ ...S.chip, background: "#E8EBF0", color: "#4A5A7A" }}>{step.time}</span>}
                            </div>
                            {step.note && <div style={{ fontSize: 11, color: "#9A9A92", fontStyle: "italic", marginTop: 6 }}>💡 {step.note}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <button style={{ ...S.btn, ...S.btnOutline, width: "100%", marginTop: 8 }} onClick={reset}>Start over</button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#FAFAF7" },
  header: { padding: "32px 20px 20px", textAlign: "center", borderBottom: "1px solid #E0DAD0" },
  eyebrow: { fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C8552A", marginBottom: 8 },
  h1: { fontFamily: "'Cormorant Garamond', serif", fontSize: 34, fontWeight: 300, lineHeight: 1.1, letterSpacing: "-0.02em" },
  progress: { display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "20px 0 8px" },
  content: { padding: "16px 16px 80px" },
  card: { background: "#F5F0E8", border: "1px solid #E0DAD0", borderRadius: 2, padding: "24px 20px", marginBottom: 12 },
  cardTitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 300, marginBottom: 4 },
  cardSub: { fontSize: 11, color: "#9A9A92", letterSpacing: "0.05em", marginBottom: 20 },
  dropZone: { border: "1.5px dashed #E0DAD0", borderRadius: 2, padding: "40px 20px", cursor: "pointer", background: "#FAFAF7", marginBottom: 0, transition: "all 0.2s", minHeight: 180, display: "flex", alignItems: "center", justifyContent: "center" },
  dropZoneActive: { padding: 0, border: "1.5px solid #E0DAD0", overflow: "hidden" },
  preview: { width: "100%", maxHeight: 280, objectFit: "cover", display: "block" },
  changeBtn: { width: "100%", padding: "10px", textAlign: "center", fontSize: 11, color: "#5A5A54", background: "#EDE8E0", border: "none", cursor: "pointer", letterSpacing: "0.06em", marginBottom: 0 },
  btn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "13px 20px", fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", border: "none", cursor: "pointer", borderRadius: 1, transition: "all 0.15s", flex: 1 },
  btnPrimary: { background: "#1C1C1A", color: "#F5F0E8" },
  btnOutline: { background: "transparent", color: "#5A5A54", border: "1px solid #E0DAD0", flex: "0 1 auto" },
  btnDisabled: { background: "#C0BAB0", cursor: "not-allowed" },
  btnRow: { display: "flex", gap: 10, marginTop: 20 },
  errorBox: { background: "#FDF0ED", border: "1px solid #E8C5BC", padding: "12px 16px", fontSize: 12, color: "#C8552A", borderRadius: 1, marginBottom: 16, letterSpacing: "0.03em" },
  backLink: { background: "none", border: "none", fontSize: 11, color: "#9A9A92", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", padding: 0, marginBottom: 16, display: "block" },
  noteBox: { fontSize: 11, color: "#5A5A54", padding: "10px 14px", background: "#FAFAF7", borderLeft: "2px solid #3D6B4A", marginBottom: 16, fontStyle: "italic" },
  tag: { display: "inline-flex", alignItems: "center", gap: 8, background: "#FAFAF7", border: "1px solid #E0DAD0", borderRadius: 1, padding: "5px 10px", fontSize: 12 },
  tagX: { background: "none", border: "none", cursor: "pointer", color: "#9A9A92", fontSize: 16, lineHeight: 1, padding: 0 },
  input: { flex: 1, background: "#FAFAF7", border: "1px solid #E0DAD0", borderRadius: 1, padding: "11px 14px", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#1C1C1A", outline: "none" },
  recipeCard: { background: "#F5F0E8", border: "1px solid #E0DAD0", borderRadius: 2, padding: "20px 18px", cursor: "pointer" },
  recipeCardOpen: { borderColor: "#C8552A", background: "#F5EBE8" },
  difficultyBadge: { fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 8px", border: "1px solid #E0DAD0", color: "#9A9A92", whiteSpace: "nowrap", flexShrink: 0 },
  detailCard: { background: "#FAFAF7", border: "1px solid #E0DAD0", borderTop: "none", padding: "20px 18px" },
  ingBox: { background: "#F5F0E8", padding: "12px", borderRadius: 1 },
  chip: { fontSize: 10, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 1, textTransform: "uppercase" },
};
