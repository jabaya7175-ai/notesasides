// Sample content for /demo/ — shows the site with essays, reviews and cover images.
// Not stored in the database. Cover images are public-domain paintings hosted on
// Wikimedia Commons.

const commons = (file, width = 1600) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
const fn = (id, n) => `<sup class="fn" data-id="${id}">${n}</sup>`;
const dc = (frame = 'orn-double', lines = 3) => ({ on: true, lines, weight: 400, color: 'var(--ink)', frame });

export const DEMO_POSTS = [
  {
    id: 'd1', slug: 'on-the-uses-of-the-margin', kind: 'review',
    title: 'On the Uses of the Margin',
    subtitle: "Ruskin, the Gothic, and why a writer's asides deserve a place beside the text.",
    published_at: '2026-11-09T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('orn-double', 3),
    cover_url: commons('Rembrandt - The Philosopher in Meditation.jpg'),
    cover_caption: 'Philosopher in Meditation, attributed to Rembrandt, 1632. Musée du Louvre.',
    books: [{ title: 'The Stones of Venice', author: 'John Ruskin', publisher: 'Smith, Elder & Co.', year: '1851–53', pages: null, price: null, buy_url: null, cover_path: null }],
    body_html: `<h2>Introduction</h2>
<p>Every serious book once had two voices on the page: the text, set large in the center, and the gloss, crowded into the margins around it.${fn('a', 1)} The reader moved between them freely. The commentary did not interrupt the argument; it stood beside it, available when wanted and ignorable when not.</p>
<p>Modern publishing pushed those asides to the bottom of the page, and the web pushed them further still, to the end of the document, where they are reached only by a jump and a scroll back. The cost is small for any single note. Across an essay it changes how one reads: the reader abandons either the notes or the thread.</p>
<p>Ruskin would have understood the complaint. His chapter on the nature of the Gothic praises the carver who was permitted his own small invention at the edge of the great design — the leaf, the grotesque, the irregular finial.${fn('b', 2)} The building was better for the liberty it gave its margins.</p>
<h2>The Architecture of a Page</h2>
<p>A page is a plan. It has a primary axis, secondary spaces, and thresholds between them. The main column is the nave; the margin is the aisle, narrower and lower, but part of the same building and lit by the same light. To delete the aisle is to make the building simpler, not better.</p>
<blockquote><p>The margin is not where the argument goes to die. It is where the argument shows its work.</p></blockquote>
<p>That, finally, is the case for the side note: not ornament, but honesty about how thought is actually made — a main line, and the qualifications that keep it true.${fn('c', 3)}</p>`,
    notes: [
      { id: 'a', body: 'Medieval glossed Bibles set the scriptural text in a central block, with commentary written in the surrounding margins and between the lines.' },
      { id: 'b', body: '“The Nature of Gothic” appears in the second volume of <i>The Stones of Venice</i> (1853).' },
      { id: 'c', body: 'Sample text for the demonstration site.' },
    ],
  },
  {
    id: 'd2', slug: 'the-oculus', kind: 'essay',
    title: 'The Oculus',
    subtitle: 'On a building that keeps its roof open to the weather, and what it teaches about attention.',
    published_at: '2026-11-02T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('', 3),
    cover_url: commons('Giovanni Paolo Panini - Interior of the Pantheon, Rome - Google Art Project.jpg'),
    cover_caption: 'Interior of the Pantheon, Rome, Giovanni Paolo Panini, c. 1734. National Gallery of Art, Washington.',
    body_html: `<p>The Pantheon has a hole in its roof. Nearly two thousand years on, the opening at the crown of the dome is still uncovered, and when it rains, it rains inside. The floor is pitched, and drains carry the water away.${fn('a', 1)}</p>
<p>An architect learns to fear water above almost anything else. Every detail in a set of construction documents is, at some level, an argument with the weather. And yet here is the most admired room in the West, conceding the argument at its very center.</p>
<p>The concession is the point. The oculus is the only window. All the light in the room enters through it, and as the day turns, a disc of sun moves across the coffers and down the walls like the hand of a clock. The building does not merely admit the sky; it measures it.</p>
<h2>Attention</h2>
<p>There is a lesson here about attention. We tend to think of focus as closing things off. The Pantheon suggests the opposite: a single, deliberate opening, around which everything else is ordered and toward which everything else is turned.</p>`,
    notes: [{ id: 'a', body: 'The oculus is roughly 8.2 metres (27 ft) across. Sample text for the demonstration site.' }],
  },
  {
    id: 'd3', slug: 'above-the-fog', kind: 'essay',
    title: 'Above the Fog',
    subtitle: 'The sublime and the beautiful are not the same thing, and confusing them has consequences.',
    published_at: '2026-10-26T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('orn-box', 2),
    cover_url: commons('Caspar David Friedrich - Wanderer above the sea of fog.jpg'),
    cover_caption: 'Wanderer above the Sea of Fog, Caspar David Friedrich, c. 1818. Hamburger Kunsthalle.',
    body_html: `<p>Friedrich's wanderer stands with his back to us. We do not see his face, only what he sees: ridges dissolving into cloud, and beyond them nothing that can be measured. It is one of the most reproduced images of the last two centuries, and it is not, strictly speaking, beautiful.</p>
<p>The eighteenth century drew a careful line here. The beautiful is proportioned, finite, and lovable; it invites us closer. The sublime is vast, obscure, and faintly threatening; it holds us at a distance and leaves us small.${fn('a', 1)}</p>
<p>Both are real goods. But a culture that prizes only the sublime will build for awe and forget to build for love — monuments instead of houses, spectacle instead of rooms one is glad to come home to.</p>`,
    notes: [{ id: 'a', body: 'The classic statement is Edmund Burke, <i>A Philosophical Enquiry into the Origin of Our Ideas of the Sublime and Beautiful</i> (1757).' }],
  },
  {
    id: 'd4', slug: 'measuring-the-world', kind: 'essay',
    title: 'Measuring the World',
    subtitle: 'A note on vocation, from a painting of a man with a pair of dividers.',
    published_at: '2026-10-19T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('', 3),
    cover_url: commons('Johannes Vermeer - The Geographer - Google Art Project.jpg'),
    cover_caption: 'The Geographer, Johannes Vermeer, 1669. Städel Museum, Frankfurt.',
    body_html: `<p>Vermeer's geographer has looked up from his work. The dividers are still in his hand; the chart is still spread on the table; but his eyes have gone to the window, and the light has found his face.</p>
<p>It is a picture of work interrupted — or perhaps of work completed in the only way it can be, by lifting the eyes from the instrument to the thing the instrument was for. Measurement serves the world; it does not replace it.</p>
<p>Anyone who draws for a living knows the temptation to mistake the drawing for the building. The geographer is a gentle rebuke. The map is good. The window is better.</p>`,
    notes: [],
  },
  {
    id: 'd5', slug: 'aristotle-on-poetry', kind: 'review',
    title: 'What the Philosopher Saw in Homer',
    subtitle: "Rereading the Poetics: plot, character, and why stories need endings.",
    published_at: '2026-10-12T14:00:00Z', paragraph_style: 'book', align: 'ragged', drop_cap: dc('orn-double', 3),
    cover_url: commons('Rembrandt - Aristotle with a Bust of Homer - Google Art Project.jpg'),
    cover_caption: 'Aristotle with a Bust of Homer, Rembrandt, 1653. The Metropolitan Museum of Art.',
    books: [{ title: 'Poetics', author: 'Aristotle', publisher: 'trans. S. H. Butcher, Macmillan', year: '1895', pages: null, price: null, buy_url: null, cover_path: null }],
    body_html: `<p>Aristotle's little treatise on poetry is a lecture-notebook, compressed and occasionally cryptic, and it has outlived nearly every other book of literary theory ever written. Its central claim is simple: the soul of a tragedy is its plot.${fn('a', 1)}</p>
<p>Not character, not spectacle, not fine language — the ordered sequence of actions, with a beginning, a middle, and an end. A beginning is what does not follow from anything else; an end is what follows from something and is followed by nothing.</p>
<p>It is a definition that sounds obvious until one notices how many modern stories refuse it. Serial forms are built to defer the end indefinitely. Aristotle's insistence on completion is quietly radical: a story is a whole, and a whole must be finished to be understood.</p>`,
    notes: [{ id: 'a', body: '<i>Poetics</i> 1450a38. Sample text for the demonstration site.' }],
  },
];

export const demoBySlug = (slug) => DEMO_POSTS.find((p) => p.slug === slug);
export const demoListRows = () => DEMO_POSTS.map((p) => ({ ...p, post_books: (p.books || []).map((b, i) => ({ position: i, books: b })) }));
export const commonsImage = commons;
