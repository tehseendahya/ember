import { getContacts } from "@/lib/data";
import SearchClient from "./SearchClient";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const contacts = await getContacts();
  return <SearchClient contacts={contacts} />;
}
