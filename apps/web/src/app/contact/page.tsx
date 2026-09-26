import { ComingSoon } from '@/components/layout/coming-soon';
import { COMING_SOON } from '@/lib/navigation';

const page = COMING_SOON['contact']!;
export const metadata = { title: page.title };

export default function Page() {
  return <ComingSoon {...page} />;
}
