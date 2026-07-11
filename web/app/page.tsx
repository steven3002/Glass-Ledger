import Link from "next/link";

const surfaces = [
  {
    href: "/ledger",
    name: "Ledger",
    description:
      "The public ledger: items, debts and their ages, pool and ceiling state — read entirely from chain over public RPC.",
  },
  {
    href: "/buy",
    name: "Buy",
    description:
      "Scan a tag, verify it against the chain, buy, and redeem the ownership certificate with a claim code.",
  },
  {
    href: "/creator",
    name: "Creator",
    description:
      "The consignment view: tagged items with their Merkle membership shown against the posted tranche root.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Glass Ledger</h1>
        <p className="mt-2 text-sm opacity-70">
          Every guarantee on these pages is read from the chain, never from an
          operator&apos;s server.
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {surfaces.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block rounded-lg border border-black/10 p-4 transition-colors hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            >
              <span className="font-medium">{s.name}</span>
              <p className="mt-1 text-sm opacity-70">{s.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
