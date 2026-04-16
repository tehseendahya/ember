import { getContacts, getTodayData, getWeeklyDigest } from "@/lib/data";
import TodayClient from "@/components/TodayClient";
import { getGoogleIntegrationStatus } from "@/lib/integrations/google-calendar";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [today, digest, contacts, googleIntegrationStatus] = await Promise.all([
    getTodayData(),
    getWeeklyDigest(),
    getContacts(),
    getGoogleIntegrationStatus(),
  ]);
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const dueReminders = today.dueReminders.map((r) => ({
    ...r,
    contactName: r.contactId ? (byId.get(r.contactId)?.name ?? null) : null,
  }));

  return (
    <TodayClient
      staleContacts={today.staleContacts}
      dueReminders={dueReminders}
      digest={digest}
      googleIntegrationStatus={googleIntegrationStatus}
    />
  );
}
