import { redirect } from 'next/navigation';

export default function LegacyPersonalAssistantSettingsPage() {
  redirect('/me?tab=assistant');
}
