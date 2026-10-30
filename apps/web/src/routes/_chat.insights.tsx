import { createFileRoute } from "@tanstack/react-router";
import { InsightsPage } from "../components/insights/InsightsPage";

export const Route = createFileRoute("/_chat/insights")({ component: InsightsPage });
