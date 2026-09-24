import { ClientBoard } from "@/components/app/ClientBoard";
import { THEME_BOOT_SCRIPT } from "@/components/app/themeScript";

export default function Home() {
  return (
    <>
      {/* Apply the stored light/dark choice before the (client-only) board paints. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <ClientBoard />
    </>
  );
}
