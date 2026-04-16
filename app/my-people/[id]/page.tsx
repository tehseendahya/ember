import { notFound } from "next/navigation";
import { getContactById, getContacts, getSecondDegreeEdges } from "@/lib/data";
import ContactDetailClient from "./ContactDetailClient";

export const dynamic = "force-dynamic";

export default async function ContactProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [contact, allContacts, allEdges] = await Promise.all([
    getContactById(id),
    getContacts(),
    getSecondDegreeEdges(),
  ]);
  if (!contact) notFound();
  const secondDegreeEdges = allEdges.filter((e) => e.introducerContactId === id);
  return (
    <ContactDetailClient
      contact={contact}
      allContacts={allContacts}
      secondDegreeEdges={secondDegreeEdges}
    />
  );
}
