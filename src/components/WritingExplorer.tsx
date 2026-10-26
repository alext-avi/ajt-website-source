import { useEffect, useMemo, useState } from 'react';

type Post = {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  date: string;
  isoDate: string;
  readingTime: number;
  example: boolean;
  draft: boolean;
  linkedinUrl?: string;
  linkedinRepost: boolean;
  image?: string;
  imageAlt?: string;
};
const categories = [
  'All',
  'Applied AI',
  'Engineering leadership',
  'Architecture',
  'Developer tools',
  'Events & reflections',
];
const Arrow = () => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M7 17 17 7M7 7h10v10" />
  </svg>
);

export default function WritingExplorer({ posts }: { posts: Post[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      setQuery(params.get('q') ?? '');
      const selected = params.get('category');
      setCategory(selected && categories.includes(selected) ? selected : 'All');
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  function update(nextQuery: string, nextCategory: string) {
    setQuery(nextQuery);
    setCategory(nextCategory);
    const url = new URL(window.location.href);
    nextQuery
      ? url.searchParams.set('q', nextQuery)
      : url.searchParams.delete('q');
    nextCategory !== 'All'
      ? url.searchParams.set('category', nextCategory)
      : url.searchParams.delete('category');
    window.history.replaceState(null, '', url);
  }
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return posts.filter(
      (p) =>
        (category === 'All' || p.category === category) &&
        terms.every((term) =>
          `${p.title} ${p.summary} ${p.tags.join(' ')}`
            .toLocaleLowerCase()
            .includes(term),
        ),
    );
  }, [query, category, posts]);
  return (
    <>
      <div className="writing-tools">
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter writing by category"
        >
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => update(query, c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="search-box">
          <label className="sr-only" htmlFor="writing-search">
            Search writing
          </label>
          <input
            id="writing-search"
            type="search"
            placeholder="Search the writing…"
            value={query}
            onChange={(e) => update(e.target.value, category)}
          />
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="6.5" />
            <path d="m15 15 5 5" />
          </svg>
        </div>
      </div>
      <p className="results-count" aria-live="polite" aria-atomic="true">
        {filtered.length} {filtered.length === 1 ? 'post' : 'posts'}
        {category !== 'All' ? ` in ${category}` : ''}
        {query.trim() ? ` matching “${query.trim()}”` : ''}
      </p>
      <div>
        {filtered.map((post) => (
          <article className="post-row" key={post.id}>
            <div className="post-date">
              <time dateTime={post.isoDate}>{post.date}</time>
              <span>{post.readingTime} min read</span>
            </div>
            <div className="post-row-main">
              <div className="post-kicker">
                {post.category}
                {post.linkedinUrl && (
                  <span className="muted">
                    LinkedIn {post.linkedinRepost ? 'commentary' : 'post'}
                  </span>
                )}
                {post.example && (
                  <span className="example-label">Example article</span>
                )}
                {post.draft && <span className="status-label">Draft</span>}
              </div>
              <h2 className="!text-[23px] !leading-[1.4] !tracking-[-0.03em]">
                <a href={`/writing/${post.id}/`}>{post.title}</a>
              </h2>
              <p>{post.summary}</p>
              {post.image && (
                <img
                  className="post-preview"
                  src={post.image}
                  alt={post.imageAlt ?? ''}
                  width="320"
                  height="200"
                  loading="lazy"
                  decoding="async"
                />
              )}
            </div>
            <a
              className="circle-link"
              href={`/writing/${post.id}/`}
              aria-label={`Read ${post.title}`}
            >
              <Arrow />
            </a>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="filter-no-results">
          <h2>No posts found.</h2>
          <p>Try another topic or a shorter search.</p>
          <button type="button" onClick={() => update('', 'All')}>
            Show all writing
          </button>
        </div>
      )}
    </>
  );
}
