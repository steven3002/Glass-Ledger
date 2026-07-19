/**
 * The demo shop's front door.
 *
 * `/demo` is the prefix the whole invented catalog lives under, so the bare URL has to lead somewhere
 * rather than 404 at the root of its own section. It leads to the collections, which is where the
 * shop actually starts — there is no separate landing to write, and inventing one would be inventing
 * content to justify a URL.
 *
 * A server component on purpose: the redirect happens before anything renders, so nobody sees a
 * flash of an empty page on the way through.
 */

import { redirect } from "next/navigation";

export default function DemoIndex() {
  redirect("/demo/collections");
}
