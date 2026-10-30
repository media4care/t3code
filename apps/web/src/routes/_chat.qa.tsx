import { createFileRoute } from "@tanstack/react-router";
import { QaPage } from "../components/qa/QaPage";

export const Route = createFileRoute("/_chat/qa")({ component: QaPage });
