import { redirect } from "next/navigation";

/**
 * Buying folded into verifying — the two were always the same act, and now they are the same page.
 * Old links and the runbook still land somewhere true.
 */
export default function BuyMoved() {
  redirect("/creator");
}
