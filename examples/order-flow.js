// Example file for manually testing the extension (and for store reviewers):
// open it on GitHub in the blob view and a 📊 badge should appear next to the
// line number of the ```mermaid fence below. Edit the diagram in a PR to see
// the 🔀 before/after badge on the "Files changed" tab.

/**
 * Processes an incoming order and returns its final status.
 *
 * ```mermaid
 * flowchart TD
 *   A[Order received] --> B{In stock?}
 *   B -- yes --> C[Charge payment]
 *   B -- no --> D{Is available for back-order?}
 *   D -- yes --> H[Back-order]
 *   D -- no --> G[Cancel]
 *   C --> E{Payment ok?}
 *   E -- yes --> F[Ship]
 *   E -- no --> G
 * ```
 *
 * @param {{ sku: string, quantity: number }} order
 * @returns {'shipped' | 'back-ordered' | 'cancelled'}
 */
function processOrder(order) {
  if (!inStock(order.sku, order.quantity)) return 'back-ordered';
  return chargePayment(order) ? 'shipped' : 'cancelled';
}

function inStock(sku, quantity) {
  return sku.length > 0 && quantity > 0;
}

function chargePayment(order) {
  return order.quantity < 100;
}
