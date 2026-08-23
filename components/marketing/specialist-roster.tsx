import {
  MailIcon,
  MegaphoneIcon,
  PenLineIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import type { ComponentType } from "react";

interface Specialist {
  readonly Icon: ComponentType<{ readonly className?: string }>;
  readonly label: string;
}

const SPECIALISTS: readonly Specialist[] = [
  { Icon: SparklesIcon, label: "Positioning" },
  { Icon: PenLineIcon, label: "Content" },
  { Icon: MegaphoneIcon, label: "Social" },
  { Icon: SearchIcon, label: "Search" },
  { Icon: MailIcon, label: "Email" },
];

export function SpecialistRoster() {
  return (
    <div aria-label="Marketing specialists" className="specialist-roster">
      {SPECIALISTS.map(({ Icon, label }) => (
        <div className="specialist-roster-item" key={label}>
          <span className="specialist-roster-icon">
            <Icon className="size-3.5" />
          </span>
          <span>{label}</span>
          <span aria-hidden="true" className="specialist-roster-status" />
        </div>
      ))}
    </div>
  );
}
