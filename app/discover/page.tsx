import { getContacts } from "@/lib/data";
import DiscoverClient from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const contacts = await getContacts();
  return <DiscoverClient contacts={contacts} />;
}
