import ProgressBar from "./ProgressBar";

interface Props {
  projectId: string;
  expectedVersion: number;
  isOwner: boolean;
  progressPercentage: number;
  startDate?: string | null;
  expectedEndDate?: string | null;
}

const ProgressControl = ({ progressPercentage, startDate, expectedEndDate }: Props) => (
  <div className="space-y-2">
    <ProgressBar value={progressPercentage} />
    <p className="text-xs text-muted-foreground">
      {startDate && expectedEndDate ? "Automatisch op basis van de geplande begin- en einddatum." : "Stel een begin- en einddatum in voor automatische voortgang."}
    </p>
  </div>
);

export default ProgressControl;
