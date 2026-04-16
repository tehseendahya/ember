import {
  getContacts,
  getNetworkEdges,
  getSecondDegreeEdges,
} from "@/lib/data";
import { buildGraphViewModel } from "@/lib/network/graph-view-model";
import MyPeopleClient from "./MyPeopleClient";

export const dynamic = "force-dynamic";

export default async function MyPeoplePage() {
  const [contacts, networkEdges, secondDegreeEdges] = await Promise.all([
    getContacts(),
    getNetworkEdges(),
    getSecondDegreeEdges(),
  ]);
  const graphModel = buildGraphViewModel({ contacts, networkEdges, secondDegreeEdges });
  return (
    <MyPeopleClient
      contacts={contacts}
      graphModel={graphModel}
    />
  );
}
