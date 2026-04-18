import { getContacts, getProfileContext } from "@/lib/data";
import DiscoverClient from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const [contacts, profileContext] = await Promise.all([
    getContacts(),
    getProfileContext().catch(() => ""),
  ]);
  return <DiscoverClient contacts={contacts} profileContext={profileContext} />;
}
