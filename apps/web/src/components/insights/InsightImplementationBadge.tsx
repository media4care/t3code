import type { InsightRecommendation } from "@t3tools/contracts";
import {
  INSIGHT_IMPLEMENTATION_LABELS,
  insightImplementationStatus,
} from "@t3tools/client-runtime/insights";
import { CheckIcon, CircleIcon, HammerIcon } from "lucide-react";
import { Badge } from "../ui/badge";

export function InsightImplementationBadge({
  recommendation,
}: {
  recommendation: InsightRecommendation;
}) {
  const status = insightImplementationStatus(recommendation);
  const Icon =
    status === "implemented" ? CheckIcon : status === "started" ? HammerIcon : CircleIcon;
  return (
    <Badge
      variant={status === "implemented" ? "success" : status === "started" ? "info" : "outline"}
    >
      <Icon aria-hidden />
      {INSIGHT_IMPLEMENTATION_LABELS[status]}
    </Badge>
  );
}
