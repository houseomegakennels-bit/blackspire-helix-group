"use client";
import { useState, type FormEvent } from "react";
import { publicContact } from "@/lib/public-contact";
export function PublicContactForm() {
  const [prepared, setPrepared] = useState(false);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = `Name: ${data.get("name")}\nEmail: ${data.get("email")}\nBusiness: ${data.get("company") || "Not provided"}\n\n${data.get("message")}`;
    window.location.href = `${publicContact.emailHref}?subject=${encodeURIComponent("Let’s talk about my business")}&body=${encodeURIComponent(body)}`;
    setPrepared(true);
  }
  return (
    <form onSubmit={prepare} className="public-form">
      <label htmlFor="contact-name">
        Your name
        <input
          id="contact-name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
        />
      </label>
      <label htmlFor="contact-email">
        Your email
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <label htmlFor="contact-company">
        Business name (optional)
        <input
          id="contact-company"
          name="company"
          autoComplete="organization"
          maxLength={150}
        />
      </label>
      <label htmlFor="contact-message">
        What would you like to make easier?
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          required
          maxLength={2000}
          placeholder="For example: I spend too much time following up with new customers."
        />
      </label>
      <p className="public-detail">
        This opens a draft in your email app. Review it and press Send there to
        contact us.
      </p>
      <button type="submit" className="public-button">
        Prepare my email
      </button>
      {prepared && (
        <p role="status">
          Your email app should open with your draft. Your message has not been
          sent by this website. If nothing opened, email{" "}
          <a href={publicContact.emailHref}>{publicContact.email}</a> or call{" "}
          <a href={publicContact.phoneHref}>{publicContact.phone}</a>.
        </p>
      )}
    </form>
  );
}
