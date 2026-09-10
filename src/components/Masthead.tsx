import { FileText, Headphones, ListTree, ShieldCheck } from 'lucide-react';

/**
 * What this place is, said plainly, above the shelf.
 *
 * A reader arriving for the first time sees an upload box and no explanation.
 * This is the one piece of the interface whose whole job is to answer "what is
 * this?" before they have to try it and find out.
 *
 * Once there are books on the shelf that question is answered, so the four
 * supporting points fold away and the statement itself stays. A returning
 * reader came for their library, not for the pitch.
 */
export function Masthead({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`masthead${compact ? ' compact' : ''}`}>
      <span className="masthead-rule" />
      <p className="masthead-eyebrow">PDF to audio</p>
      <h1 className="masthead-title">Every book you own, read aloud.</h1>
      <p className="masthead-lede">
        Bring in a PDF and the Nairobian Reading Room turns it into an audiobook.
        It finds the chapters, rejoins words broken across a line, lifts out the
        footnotes and page numbers, then reads what is left in a voice and at a
        pace you choose. Your place is kept for when you come back.
      </p>
      {!compact && (
      <ul className="masthead-points">
        <li>
          <FileText size={15} />
          <span><strong>Any PDF.</strong> Novels, papers, scans. Two columns and encrypted files included.</span>
        </li>
        <li>
          <ListTree size={15} />
          <span><strong>Real structure.</strong> Chapter list, bookmarks, and a queue that plays book after book.</span>
        </li>
        <li>
          <Headphones size={15} />
          <span><strong>Natural pacing.</strong> Proper rests at full stops, paragraphs and chapter breaks.</span>
        </li>
        <li>
          <ShieldCheck size={15} />
          <span><strong>Stays with you.</strong> Everything runs on this device. No book is ever uploaded.</span>
        </li>
      </ul>
      )}
    </header>
  );
}
