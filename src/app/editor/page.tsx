import {connection} from "next/server";
import {requireMember} from "@/lib/auth";
import {notFound} from "next/navigation";
import {Masthead,TipLink} from "@/components/newspaper";
import {Workspace} from "@/components/workspace";
export default async function Page() {await connection();const member=await requireMember("/editor");if(!member.is_editor)notFound();return <><Masthead/><main id="main"><Workspace path={["editor"]}/><TipLink/></main></>;}