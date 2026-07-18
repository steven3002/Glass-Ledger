import { redirect } from "next/navigation";

/** The ledger is the home page now. Old links and the runbook still land somewhere true. */
export default function LedgerMoved() {
  redirect("/");
}
