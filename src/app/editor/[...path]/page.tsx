import {connection} from "next/server";
import {requireMember} from "@/lib/auth";
import {notFound} from "next/navigation";
import {Masthead,TipLink} from "@/components/newspaper";
import {Workspace} from "@/components/workspace";
export default async function Page({params}:{params:Promise<{path:string[]}>}) {await connection();const {path}=await params;const member=await requireMember(`/editor/${path.join("/")}`);if(!member.is_editor)notFound();if(!["tips","articles","issues","members","imports"].includes(path[0]))notFound();return <><Masthead/><main id="main"><Workspace key={path.join("/")} path={["editor",...path]}/></main></>;}