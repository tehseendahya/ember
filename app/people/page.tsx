import {
  getContacts,
  getNetworkEdges,
  getSecondDegreeEdges,
} from "@/lib/data";
import { buildGraphViewModel } from "@/lib/network/graph-view-model";
import PeopleClient from "./PeopleClient";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const [contacts, networkEdges, secondDegreeEdges] = await Promise.all([
    getContacts(),
    getNetworkEdges(),
    getSecondDegreeEdges(),
  ]);
  const graphModel = buildGraphViewModel({ contacts, networkEdges, secondDegreeEdges });
  return (
    <PeopleClient
      contacts={contacts}
      graphModel={graphModel}
    />
  );
}
