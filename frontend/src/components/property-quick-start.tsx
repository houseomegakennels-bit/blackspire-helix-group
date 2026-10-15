/** Native disclosures keep help available without blocking work or requiring storage. */
export function PropertyQuickStart({ practice = false }: { practice?: boolean }) {
  return <details className="property-quick-start">
    <summary>New here? Start with these three steps</summary>
    <div className="property-quick-start-body">
      <ol>
        <li><strong>Add or open a property.</strong> {practice ? "Use Properties to create a practice record or open one you already saved." : "Choose Add a property, or open an address under Your properties."}</li>
        <li><strong>Review what you know.</strong> Open Numbers and enter confirmed figures. Leave unknown amounts blank; use zero only when none applies.</li>
        <li><strong>Save before you leave.</strong> Use the section’s Save button and wait for confirmation. Changing sections does not save your entries.</li>
      </ol>
      <p>{practice ? "Practice changes stay in your private practice workspace. Nothing here sends outreach or starts a paid search." : "Follow the property’s Next step to decide what to review. Opening a section does not send an offer or message."}</p>
      <details className="property-word-help">
        <summary>What do these property terms mean?</summary>
        <dl>
          <div><dt>ARV — after-repair value</dt><dd>An estimate of what the property could sell for after repairs. Compare recent sales of similar renovated properties.</dd></div>
          <div><dt>Comps — comparable sales</dt><dd>Similar properties that recently sold nearby. Asking prices alone do not confirm a sale value.</dd></div>
          <div><dt>Earnest money</dt><dd>A deposit connected to a purchase agreement. Confirm the amount and terms in the agreement before entering it.</dd></div>
          <div><dt>Assignment fee</dt><dd>The fee for transferring your rights under a purchase contract to another buyer. A target fee is not money already earned.</dd></div>
        </dl>
      </details>
      <p className="property-help-hint">Tap the heading again to close this guide. You can reopen it whenever you need it.</p>
    </div>
  </details>;
}
