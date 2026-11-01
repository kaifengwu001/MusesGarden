import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalLink, parseFeed } from './rss';

const SAMPLES = new URL('./samples/', import.meta.url);
const recorded = readdirSync(SAMPLES)
  .filter((f) => f.endsWith('.xml'))
  .map((f) => [f, readFileSync(new URL(f, SAMPLES), 'utf8')] as const);

describe('canonicalLink', () => {
  it('forces https, lower-cases the host, and drops utm_* params and the fragment', () => {
    expect(canonicalLink('HTTP://WWW.Example.COM/Essay/a?utm_source=rss&id=2&UTM_Medium=feed#comments')).toBe('https://www.example.com/Essay/a?id=2');
    expect(canonicalLink('http://example.com/x?utm_campaign=z')).toBe('https://example.com/x');
    expect(canonicalLink(' https://example.com/q?a=b%20c ')).toBe('https://example.com/q?a=b%20c');
  });
});

describe('parseFeed', () => {
  it('reads CDATA and entity-encoded RSS items into plain text with canonical links', () => {
    const xml = `<rss><channel><title>Daily &amp; Weekly</title>
      <item><title><![CDATA[Indigo &amp; Woad
      ]]></title><link>http://Example.org/indigo?utm_source=rss#top</link>
      <pubDate>Tue, 27 Oct 2026 09:00:00 +0000</pubDate><dc:creator><![CDATA[Ada Blue]]></dc:creator>
      <description><![CDATA[<p><img src="https://img.example.org/woad.jpg" /> Blue from <b>leaves</b> &amp; vats.</p>
      <p>The post <a href="x">Indigo</a> appeared first on <a href="y">Daily</a>.</p>]]></description>
      <content:encoded><![CDATA[<p>One two three four.</p>]]></content:encoded></item>
      <item><title>Frank &amp; Nancy&#8217;s Museum</title><link>https://example.org/museum</link>
      <media:content url="https://img.example.org/museum.jpg" medium="image" width="1200" height="800"/>
      <description>&lt;p&gt;A small &lt;em&gt;museum&lt;/em&gt;.&lt;/p&gt;</description></item>
      <item><title>No link</title></item>
    </channel></rss>`;
    expect(parseFeed(xml)).toEqual({
      title: 'Daily & Weekly',
      items: [
        {
          url: 'http://Example.org/indigo?utm_source=rss#top',
          link: 'https://example.org/indigo',
          title: 'Indigo & Woad',
          summary: 'Blue from leaves & vats.',
          thumb: 'https://img.example.org/woad.jpg',
          published: '2026-10-27',
          author: 'Ada Blue',
          words: 4,
        },
        {
          url: 'https://example.org/museum',
          link: 'https://example.org/museum',
          title: 'Frank & Nancy’s Museum',
          summary: 'A small museum.',
          thumb: 'https://img.example.org/museum.jpg',
        },
      ],
    });
  });

  it('reads Atom entries: the alternate link, the summary, the author and the date', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Type Notes</title>
      <entry><title>Caslon at 300</title><link rel="replies" href="https://example.org/caslon#comments"/>
      <link rel="alternate" type="text/html" href="https://example.org/caslon"/>
      <published>2026-09-01T10:00:00Z</published><author><name>R. Punch</name></author>
      <summary type="html">&lt;p&gt;A face that &lt;b&gt;lasted&lt;/b&gt;.&lt;/p&gt;</summary></entry>
    </feed>`;
    expect(parseFeed(xml)).toEqual({
      title: 'Type Notes',
      items: [{ url: 'https://example.org/caslon', link: 'https://example.org/caslon', title: 'Caslon at 300', summary: 'A face that lasted.', published: '2026-09-01', author: 'R. Punch' }],
    });
  });

  it('parses every recorded feed into clean items', () => {
    expect(recorded.length).toBeGreaterThan(0);
    for (const [name, xml] of recorded) {
      const feed = parseFeed(xml);
      expect(feed.title, name).not.toBe('');
      expect(feed.items.length, name).toBeGreaterThan(0);
      for (const item of feed.items) {
        expect(item.link.startsWith('https://')).toBe(true);
        expect(item.link).not.toMatch(/#|utm_/i);
        expect(item.title).not.toMatch(/<|&amp;|CDATA/);
        expect(item.summary.length).toBeLessThanOrEqual(400);
        expect(item.summary).not.toMatch(/<|appeared first on/);
      }
    }
  });
});
