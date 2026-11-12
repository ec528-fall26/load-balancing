import { redirect } from "next/navigation";

export default function FanoutPage() {
  redirect("/compare?fanout=1");
}
