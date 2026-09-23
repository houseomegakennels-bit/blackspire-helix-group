import type { ReactNode } from 'react';
import { requireWorkspacePage } from '@/lib/operator-access';
export default async function NexusLayout({children}:{children:ReactNode}){await requireWorkspacePage();return children;}
