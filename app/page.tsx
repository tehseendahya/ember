import { getContacts, getTodayData } from "@/lib/data";
import HomeClient from "@/components/HomeClient";
import { getGoogleIntegrationStatus } from "@/lib/integrations/google-calendar";
import { getTodaysMeetingsWithBriefings } from "@/lib/briefings/today";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [today, contacts, googleIntegrationStatus, todaysMeetings] = await Promise.all([
    getTodayData(),
    getContacts(),
    getGoogleIntegrationStatus(),
    getTodaysMeetingsWithBriefings().catch(() => []),
  ]);
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const dueReminders = today.dueReminders.map((r) => ({
    ...r,
    contactName: r.contactId ? (byId.get(r.contactId)?.name ?? null) : null,
  }));

  return (
    <HomeClient
      staleContacts={today.staleContacts}
      dueReminders={dueReminders}
      todaysMeetings={todaysMeetings}
      googleIntegrationStatus={googleIntegrationStatus}
    />
  );
}
