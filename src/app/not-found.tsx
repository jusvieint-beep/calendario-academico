import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <div className="empty">
        <b>Esta página no existe</b>
        <p><Link className="btn" href="/">Ir al calendario</Link></p>
      </div>
    </main>
  );
}
