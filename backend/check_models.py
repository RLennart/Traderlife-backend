"""
Testet welche Gemini-Modelle mit deinem API-Key verfügbar sind.
"""
import os, json
from dotenv import load_dotenv
load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY", "")
if not API_KEY:
    API_KEY = input("Gemini API Key eingeben: ").strip()

from google import genai
client = genai.Client(api_key=API_KEY)

print("=== Alle Modelle auflisten ===\n")
all_models = []
for m in client.models.list():
    name = m.name.replace("models/", "")
    all_models.append(name)
    print(f"  {name}")

print(f"\n{len(all_models)} Modelle gesamt.")

# Bevorzugte Reihenfolge
PREFERRED = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.0-pro",
]

# Filter: nur stabile (kein "exp", kein "preview", kein "learnlm")
stable = [m for m in all_models if not any(x in m for x in ["exp", "preview", "learnlm", "thinking"])]
print(f"\nStabile Modelle: {stable}")

# Bestes wählen
best = None
for p in PREFERRED:
    if p in stable:
        best = p
        break
if not best:
    for p in PREFERRED:
        if p in all_models:
            best = p
            break
if not best and stable:
    best = stable[0]
if not best and all_models:
    best = all_models[0]

print(f"\n→ Bestes Modell: {best}")

# Funktionstest
if best:
    print(f"\nTeste '{best}'...")
    try:
        r = client.models.generate_content(model=best, contents='Say: OK')
        print(f"  ✓ Funktioniert! Antwort: {r.text.strip()[:60]}")
    except Exception as ex:
        print(f"  ✗ Fehler: {ex}")
        # Alle durchprobieren
        for candidate in stable or all_models:
            if candidate == best:
                continue
            try:
                r = client.models.generate_content(model=candidate, contents='Say: OK')
                print(f"  ✓ Fallback funktioniert: {candidate}")
                best = candidate
                break
            except Exception:
                pass

result = {"best_model": best, "available": all_models}
with open("best_model.json", "w") as f:
    json.dump(result, f, indent=2)
print(f"\nGespeichert in best_model.json → {best}")
