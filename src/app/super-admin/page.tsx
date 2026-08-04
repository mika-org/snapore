import { redirect } from "next/navigation";
import { SuperAdminConsole } from "@/components/super-admin-console";
import { getCurrentUser } from "@/lib/auth";

export default async function SuperAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");
  return <SuperAdminConsole name={user.name} />;
}
