import { Suspense } from "react";
import { getExtrasContent } from "@/server/content";
import { ExtrasClient } from "./ExtrasClient";

export default async function ExtrasPage() {
  const extrasContent = await getExtrasContent();
  return (
    <Suspense>
      <ExtrasClient extrasContent={extrasContent} />
    </Suspense>
  );
}
