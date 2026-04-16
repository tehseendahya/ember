import SettingsClient from "@/components/SettingsClient";
import { getProfileContext } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profileContext = await getProfileContext();
  return <SettingsClient initialProfileContext={profileContext} />;
}
