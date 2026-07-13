import Link from "next/link";

const surfaces = [
  {
    href: "/ledger",
    name: "The ledger",
    line: "Everything the shop owes, and to whom, and for how long it has owed it.",
    body:
      "Items and their states. Debts with their ages ticking. The pool, the allowance, and the ceiling " +
      "that closes the till when Good is holding more of other people's money than it has earned the " +
      "right to hold. Read from the chain, by this page, over a public connection anyone can use.",
  },
  {
    href: "/buy",
    name: "Buy",
    line: "Check a dress before you pay for it — without asking the shop anything.",
    body:
      "Scan the tag. Your browser fetches the creator's signed voucher from public storage, recovers " +
      "her signature, walks the consignment's proof, and reads whether the item has already been sold. " +
      "Genuine, forged, or a copy of something already gone: you find out, not the shop.",
  },
  {
    href: "/creator",
    name: "The tags",
    line: "The whole consignment on one wall — with one forgery and one clone among them.",
    body:
      "Every tag the creator signed, each verifying live against the root the chain holds. Plus a " +
      "forged tag, signed in your browser by a key nobody registered, and a clone of one already sold. " +
      "They look identical. They are not, and you can prove which is which without permission.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">A shop you do not have to trust.</h1>
      <p className="mt-4 max-w-2xl leading-relaxed text-neutral-400">
        A creator consigns a dress. It sells. Four people are owed money in the same second, and every
        one of those debts is on a clock that only runs one way — toward a default that anybody in the
        world can collect, without filing anything, without accusing anybody, and without the shop&rsquo;s
        cooperation.
      </p>
      <p className="mt-3 max-w-2xl leading-relaxed text-neutral-400">
        Every page here reads the chain directly. Switch the shop off — the demo does, on purpose — and
        the tags still verify, the clocks still run, and the ledger still answers. The only thing that
        stops is the till.
      </p>

      <ul className="mt-12 grid gap-4">
        {surfaces.map((surface) => (
          <li key={surface.href}>
            <Link
              href={surface.href}
              className="block rounded-xl border border-neutral-800 bg-neutral-950/60 p-6 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-lg font-semibold">{surface.name}</span>
                <span className="text-sm text-neutral-400">{surface.line}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500">{surface.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
