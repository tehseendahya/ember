import {
  getContacts,
  getExtendedConnections,
  getNetworkEdges,
} from "@/lib/data";
import MyPeopleClient from "./MyPeopleClient";

export const dynamic = "force-dynamic";

export default async function MyPeoplePage() {
  const [contacts, networkEdges, extendedConnections] = await Promise.all([
    getContacts(),
    getNetworkEdges(),
    getExtendedConnections(),
  ]);
  return (
    <MyPeopleClient
      contacts={contacts}
      networkEdges={networkEdges}
      extendedConnections={extendedConnections}
    />
  );
}
