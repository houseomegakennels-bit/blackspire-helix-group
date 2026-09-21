export const offers = [
  {
    title: "Follow up before leads go cold.",
    text: "Give new inquiries a clear next step, send timely follow-ups, and keep customer conversations organized.",
    examples: "Lead capture · Follow-up messages · Appointment reminders",
  },
  {
    title: "Get the busywork off your plate.",
    text: "Connect the tools you already use and cut the copying, chasing, and repetitive admin that eats up your day.",
    examples: "Forms · Task handoffs · Customer records",
  },
  {
    title: "A website that helps win business.",
    text: "Make it easy for customers to understand your services, trust your business, and get in touch.",
    examples: "Business websites · Online inquiries · Custom apps",
  },
];
export function PublicOffers() {
  return (
    <div className="public-grid">
      {offers.map((offer, i) => (
        <article className="public-card" key={offer.title}>
          <span className="public-number">0{i + 1}</span>
          <h3>{offer.title}</h3>
          <p>{offer.text}</p>
          <p className="public-detail">{offer.examples}</p>
        </article>
      ))}
    </div>
  );
}
