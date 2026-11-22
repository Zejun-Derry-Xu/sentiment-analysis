import React, { useEffect, useRef, useState } from "react";
import "./hoya-wall.css";

export type WallCategory = "All" | "Free Food" | "Activities" | "Academics";
type Board = { id: string; title: string; description: string; category: string; comment_count: number };
type Flyer = {
  id: string; category: Exclude<WallCategory, "All">; title: string; copy: string;
  tag: string; board: string; fields: [string, string][];
  status?: "Still available" | "All gone" | "Expired";
};
const categories = [
  { category: "Free Food", title: "Free Food Radar", headline: <>GOOD FOOD.<br />ZERO DOLLARS.</>, copy: "Free bites on campus and around Georgetown. Find out where, when, and what you need to claim them.", aside: "Will walk for free food.", icon: "✳" },
  { category: "Activities", title: "Activities", headline: <>GOT<br />PLANS?</>, copy: "Find campus events, club meetups, and something to do beyond your usual routine.", aside: "Your group chat needs a plan.", icon: "✦" },
  { category: "Academics", title: "Academics & Beyond", headline: <>WHAT’S<br />NEXT?</>, copy: "Explore courses, short-term study abroad programs, academic events, and advice from fellow Hoyas.", aside: "Before you register, ask a Hoya.", icon: "↗" },
] as const;
const flyers: Flyer[] = [
  { id: "pizza", category: "Free Food", title: "Pizza with a side of campus life.", copy: "The classic campus equation: a club meetup + a slice. An example of what belongs on the radar.", tag: "Sample offer", board: "campus-makers", status: "Still available", fields: [["Where", "Location to be confirmed"], ["When", "Date & pickup window TBD"], ["To claim", "Eligibility to be confirmed"], ["Source", "Illustrative club flyer"], ["Updated", "Not verified · sample only"]] },
  { id: "refreshments", category: "Free Food", title: "Come for the talk. Stay for the snacks.", copy: "Lecture refreshments, while supplies last. This sample shows how a food update appears after the snacks run out.", tag: "Sample offer", board: "campus-makers", status: "All gone", fields: [["Where", "Venue to be confirmed"], ["When", "Event time TBD"], ["To claim", "Attendance requirements TBD"], ["Source", "Illustrative lecture flyer"], ["Updated", "Not verified · sample only"]] },
  { id: "falafel", category: "Free Food", title: "A falafel worth the walk?", copy: "Inspired by a student-shared Falafel Inc flyer. The offer’s dates and terms have not been verified. Check with the merchant before making plans.", tag: "Reference only · unverified", board: "campus-makers", fields: [["Where", "Confirm with Falafel Inc"], ["Valid until", "Unknown · not an active offer"], ["To claim", "Current conditions unverified"], ["Source", "Student-provided reference image"], ["Updated", "No verified update"]] },
  { id: "haunted", category: "Activities", title: "HALLOWEEN HAUNTED HOUSE", copy: "Bring a friend. Find out who screams first.", tag: "Sample event", board: "spring-sounds", fields: [["Date & time", "To be announced"], ["Where", "Venue to be confirmed"], ["Hosted by", "Organizer TBD"], ["Sign up", "Registration link pending"], ["Cost", "Free entry not confirmed"]] },
  { id: "movie", category: "Activities", title: "One movie. Your whole crew.", copy: "Movie nights, club meetups, performances, and campus hangouts. There’s room for all of them here.", tag: "Sample event", board: "spring-sounds", fields: [["Date & time", "To be announced"], ["Where", "Venue to be confirmed"], ["Hosted by", "Student organization TBD"], ["Sign up", "Registration link pending"], ["Cost", "To be confirmed"]] },
  { id: "dsan", category: "Academics", title: "Before you register, ask a Hoya.", copy: "Workload? Favorite project? What do you wish you’d known? Swap course experiences with fellow Hoyas.", tag: "Courses · DSAN", board: "night-run", fields: [["Course", "DSAN · course number TBD"], ["Semester", "Choose a term in your post"], ["Student experience", "Join the course discussion"]] },
  { id: "abroad", category: "Academics", title: "A short program. A whole new perspective.", copy: "A place for short-term study abroad and summer opportunities. This is an example, not an open application.", tag: "Sample program", board: "night-run", fields: [["Destination", "To be confirmed"], ["Duration", "To be confirmed"], ["Apply by", "No verified deadline"], ["Eligibility", "Check official program requirements"], ["Official link", "Pending verification"]] },
  { id: "workshop", category: "Academics", title: "Follow your curiosity.", copy: "Talks, workshops, and learning opportunities beyond the syllabus. Share a question, find your next rabbit hole.", tag: "Talks & Workshops · Sample", board: "night-run", fields: [["Date & time", "To be announced"], ["Where", "Venue to be confirmed"], ["Official link", "Pending verification"]] },
];

function readSaved(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem("hoya-saved-flyers") || "[]"); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []; } catch { return []; }
}

export function PosterPreview() {
  return <div className="poster-preview" aria-label="A little preview of the wall">
    <div className="preview-flyer preview-food"><span>FREE FOOD RADAR</span><strong>GOOD FOOD.<br />ZERO<br />DOLLARS.</strong><div className="pizza-doodle" aria-hidden="true">△<i>• •<br /> •</i></div><small>Big appetite. Student budget.</small><div className="mini-tears">TAKE A BITE · TAKE A BITE</div></div>
    <div className="preview-flyer preview-plans"><span>ACTIVITIES / ON THE HILLTOP</span><strong>GOT<br />PLANS?</strong><div className="star-doodle" aria-hidden="true">✳</div><small>Something beyond your usual routine.</small></div>
    <div className="preview-flyer preview-next"><span>ACADEMICS & BEYOND</span><strong>WHAT’S<br />NEXT?</strong><small>A little curiosity goes a long way. ↗</small></div>
    <span className="sticky sticky-saxa">Hoya Saxa!</span><span className="sticky sticky-walk">Worth the walk?</span><span className="sticky sticky-friend">Bring a friend.</span>
  </div>;
}

export function HoyaWall({ boards, category, setCategory, onDiscuss, onPost }: {
  boards: Board[]; category: WallCategory; setCategory: (v: WallCategory) => void;
  onDiscuss: (id: string) => void; onPost: () => void;
}) {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(readSaved);
  const [active, setActive] = useState<Flyer | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (active && !dialog.current?.open) dialog.current?.showModal(); }, [active]);
  function toggleSave(id: string) {
    const next = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem("hoya-saved-flyers", JSON.stringify(next)); } catch { /* Saving still works for this visit. */ }
  }
  const custom: Flyer[] = boards.filter(b => !["spring-sounds", "campus-makers", "night-run"].includes(b.id)).map(b => ({ id: b.id, category: /food/i.test(b.category) ? "Free Food" : /academic|dsan/i.test(b.category) ? "Academics" : "Activities", title: b.title, copy: b.description, tag: "Community discussion", board: b.id, fields: [["About", "Student discussion · event details unverified"]] }));
  const all = [...flyers, ...custom];
  const matches = (f: Flyer) => (category === "All" || f.category === category) && [f.title, f.copy, f.tag, f.category, ...f.fields.flat()].join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const count = all.filter(matches).length;
  const discussionAvailable = (f: Flyer) => boards.some(b => b.id === f.board);
  return <div className="hoya-home">
    <section className="wall-hero">
      <div className="wall-hero-copy"><span className="wall-kicker">GEORGETOWN’S STUDENT POSTER WALL</span>
        <h1>Big things happening.<br /><em>Right around<br className="hero-soft-break" /> the Hilltop.</em></h1>
        <p>Find free food, campus plans, and your next academic adventure—all on one wall.</p>
        <div className="wall-hero-actions"><button className="wall-button" onClick={() => document.getElementById("forum-boards")?.scrollIntoView({ behavior: "smooth" })}>Explore the wall ↗</button><button className="wall-button wall-button-outline" onClick={onPost}>Post a flyer +</button></div>
        <span className="hero-footnote">Pinned by Hoyas. For Hoyas. <span aria-hidden="true">〰</span></span>
      </div><PosterPreview />
    </section>
    <section className="wall-board" id="forum-boards" aria-labelledby="wall-title">
      <div className="wall-section-heading"><div><span className="wall-kicker">A LITTLE BIT OF EVERYTHING</span><h2 id="wall-title">On the wall.</h2></div><p>Good finds travel fast. Pass them on.</p></div>
      <div className="wall-tools"><div className="wall-filters" aria-label="Filter the wall">{(["All", "Free Food", "Activities", "Academics"] as const).map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div><label className="wall-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search the wall" placeholder="Search the wall…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      <p className="wall-sample-note">A peek at what belongs here. Example offers and events are labeled; confirm details before heading out.</p>
      <span className="wall-sr-only" role="status">{count} flyers found.</span>
      {count === 0 ? <div className="wall-empty"><h3>No flyers found.</h3><p>Try another search, or peek at the whole wall.</p><button className="wall-button" onClick={() => { setQuery(""); setCategory("All"); }}>Show all flyers</button></div> : <div className="wall-columns">{categories.filter(c => (category === "All" || c.category === category) && all.some(f => f.category === c.category && matches(f))).map(c => <section className={`wall-column column-${c.category.toLowerCase().replace(" ", "-")}`} key={c.category} aria-label={c.title}>
        <header className="category-poster"><div className="poster-topline"><h3>{c.title}</h3><span aria-hidden="true">{c.icon}</span></div><h4>{c.headline}</h4><p>{c.copy}</p><span className="poster-aside">{c.aside}</span></header>
        {c.category === "Academics" && <div className="academic-tags">{["Courses", "Short-Term Study Abroad", "Summer Programs", "Talks & Workshops", "DSAN"].map(t => <span key={t}>{t}</span>)}</div>}
        {all.filter(f => f.category === c.category && matches(f)).map(f => <article className={`wall-flyer ${f.id === "haunted" ? "haunted-flyer" : ""}`} key={f.id}>
          <div className="flyer-body"><div className="flyer-labels"><span>{f.tag}</span>{f.status && <span className={`food-status status-${f.status.toLowerCase().replace(" ", "-")}`}>Sample · {f.status}</span>}</div>
            {f.id === "haunted" && <svg className="ghost-doodle" aria-hidden="true" width="40" height="50" viewBox="0 0 40 50"><path d="M5 43V21a15 15 0 0 1 30 0v22l-7-5-8 6-8-6z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><ellipse cx="15" cy="22" rx="2" ry="3" fill="currentColor"/><ellipse cx="25" cy="22" rx="2" ry="3" fill="currentColor"/><path d="M17 32q3-5 6 0" stroke="currentColor" strokeWidth="2" fill="none"/></svg>}<h4>{f.title}</h4><p>{f.copy}</p>
            <dl className="flyer-facts">{f.fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div><div className="tear-actions"><button onClick={() => setActive(f)}>Details ↗</button><button onClick={() => onDiscuss(f.board)} disabled={!discussionAvailable(f)} title={discussionAvailable(f) ? "Open the existing community board" : "Discussion board unavailable"}>{f.category === "Activities" ? "Who’s going? ↗" : "Discuss ↗"}</button><button aria-pressed={saved.includes(f.id)} aria-label={`${saved.includes(f.id) ? "Unsave" : "Save"} ${f.title}`} onClick={() => toggleSave(f.id)}>{saved.includes(f.id) ? "Saved ✓" : "Save +"}</button></div>
        </article>)}
      </section>)}</div>}
      <div className="wall-endnote"><span aria-hidden="true">✳</span><p>Found something good?<br /><strong>There’s room on the wall.</strong></p><button className="wall-button" onClick={onPost}>Post a flyer +</button></div>
    </section>
    <dialog ref={dialog} className="wall-dialog" onClose={() => setActive(null)} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }} aria-labelledby="flyer-dialog-title">
      {active && <><button className="wall-dialog-close" aria-label="Close flyer details" onClick={() => dialog.current?.close()}>×</button><span className="wall-kicker">{active.tag}</span><h2 id="flyer-dialog-title">{active.title}</h2><p>{active.copy}</p>{active.status && <p className="detail-status">Illustrative availability: {active.status}. This is not a live offer.</p>}<dl className="flyer-facts">{active.fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><button className="wall-button" disabled={!discussionAvailable(active)} onClick={() => { dialog.current?.close(); onDiscuss(active.board); }}>Join the discussion ↗</button></>}
    </dialog>
  </div>;
}
