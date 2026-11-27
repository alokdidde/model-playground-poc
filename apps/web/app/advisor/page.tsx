import { redirect } from "next/navigation";

/** Renamed to "Help me choose"; keep old links working. */
export default function AdvisorPage() {
  redirect("/choose");
}
