---
name: grocery-checkout
description: "Parse a grocery list and create a checkout session at New World. Returns a mobile-friendly URL where the user can review product matches and confirm the order."
version: "1.0.0"
metadata:
  openclaw:
    emoji: "🛒"
    requires:
      tools: ["exec"]
---

# Grocery Checkout

Submit a grocery shopping list to the Herb checkout API. Returns a checkout link where the user reviews product matches on their phone and confirms the order to be added to their New World cart.

## When to Use

Activate this skill when the user:
- Sends a grocery or shopping list
- Asks to "order groceries", "buy groceries", "add to cart", or "do a shop"
- Sends a recipe and asks to buy/order the ingredients
- Says "I need to get..." followed by food items
- Sends a list of ingredients

Do NOT use this skill for general food questions, recipe suggestions, or meal planning — only when the user wants to actually purchase items.

## Steps

1. **Parse the grocery list** from the user's message. Extract each item with its quantity. If no quantity is mentioned, default to 1. Keep the item names natural (e.g. "chicken thighs" not "chicken thigh boneless skinless").

2. **Build the JSON payload** as an array of objects with "name" and "qty":

```json
{
  "items": [
    {"name": "milk", "qty": 1},
    {"name": "chicken thighs", "qty": 2},
    {"name": "avocados", "qty": 3},
    {"name": "pasta", "qty": 1}
  ]
}
```

3. **Submit to the checkout API** using exec with curl. The API URL and auth token are hardcoded below:

```bash
curl -s -X POST "https://herb-production-5000.up.railway.app/api/checkout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sweD61E7l03In2Xl0YTk1-Spo6AyaoembgewcD_Q4h0" \
  -d '{"items": [{"name": "milk", "qty": 1}, {"name": "chicken thighs", "qty": 2}]}'
```

Replace the `-d` payload with the actual parsed items from step 2.

4. **Parse the JSON response**:

```json
{
  "sessionId": "abc-123",
  "url": "https://herb-production-5000.up.railway.app/checkout/abc-123",
  "itemCount": 4,
  "needsConfirmation": 2,
  "estimatedTotal": 33.05
}
```

5. **Reply to the user** with a brief summary and the checkout URL:
   - How many items were matched
   - How many need manual selection
   - The estimated total
   - The checkout URL (clickable)
   - Tell them to tap the link to review and confirm

## Example Interaction

**User:** "Can you order me some groceries? I need milk, 2 chicken thighs, broccoli, and pasta"

**Response after API call:**

> Got it! I've found matches for your 4 items (~$33.05).
> 2 items were auto-matched, 2 need your input.
>
> Tap here to review and confirm: https://herb-production-5000.up.railway.app/checkout/abc-123

## Constraints

- Always include the checkout URL in the response — never skip it
- Never auto-confirm the order — the user MUST review via the checkout URL
- Keep item names simple and natural — do not over-specify ("milk" not "full cream dairy milk 2L")
- If the API returns an error, tell the user what went wrong
- For recipes, extract just the ingredient names and reasonable quantities — skip pantry staples like salt, pepper, oil, water unless the user specifically includes them
- qty should be an integer — if the user says "500g mince", use {"name": "beef mince 500g", "qty": 1}
