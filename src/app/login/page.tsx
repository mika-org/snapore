import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "SUPER_ADMIN" ? "/super-admin" : "/admin");
  return <LoginForm />;
}
