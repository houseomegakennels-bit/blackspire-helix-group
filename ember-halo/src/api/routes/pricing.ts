/**
 * Ember Halo — Live Pricing API
 * GET /api/rose-packages?admin_id=...
 * Returns current pricing for standard and active special packages.
 * No hardcoded prices anywhere in the frontend.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface RosePackage {
  id: string;
  package_name: string;
  rose_count: number;
  pickup_price: number;
  delivery_price: number;
  custom_quote_required: boolean;
  is_special: false;
}

export interface SpecialRosePackage {
  id: string;
  package_name: string;
  rose_count: number;
  pickup_price: number | null;
  delivery_price: number | null;
  requires_admin_approval: boolean;
  description: string | null;
  image_url: string | null;
  is_special: true;
  end_date: string | null;
}

export interface PricingResponse {
  admin_id: string;
  standard_packages: RosePackage[];
  special_packages: SpecialRosePackage[];
  fetched_at: string;
}

export async function getLivePricing(adminId: string): Promise<PricingResponse> {
  const [standardResult, specialResult] = await Promise.all([
    supabase
      .schema('ember_halo')
      .from('packages')
      .select('id, package_name, rose_count, pickup_price, delivery_price, custom_quote_required')
      .eq('admin_id', adminId)
      .eq('is_active', true)
      .order('rose_count', { ascending: true }),

    supabase
      .schema('ember_halo')
      .from('special_packages')
      .select(`
        id, package_name, rose_count, pickup_price, delivery_price,
        requires_admin_approval, description, end_date,
        media_gallery_image_id
      `)
      .eq('admin_id', adminId)
      .eq('is_active', true)
      .eq('is_public', true)
      .or(`end_date.is.null,end_date.gte.${new Date().toISOString().split('T')[0]}`)
      .order('package_name', { ascending: true }),
  ]);

  if (standardResult.error) throw new Error(standardResult.error.message);
  if (specialResult.error) throw new Error(specialResult.error.message);

  const standard: RosePackage[] = (standardResult.data ?? []).map(p => ({
    id: p.id,
    package_name: p.package_name,
    rose_count: p.rose_count,
    pickup_price: Number(p.pickup_price),
    delivery_price: Number(p.delivery_price),
    custom_quote_required: p.custom_quote_required,
    is_special: false,
  }));

  const special: SpecialRosePackage[] = (specialResult.data ?? []).map(p => ({
    id: p.id,
    package_name: p.package_name,
    rose_count: p.rose_count,
    pickup_price: p.pickup_price != null ? Number(p.pickup_price) : null,
    delivery_price: p.delivery_price != null ? Number(p.delivery_price) : null,
    requires_admin_approval: p.requires_admin_approval,
    description: p.description,
    image_url: null, // resolved separately with signed URL
    is_special: true,
    end_date: p.end_date,
  }));

  return {
    admin_id: adminId,
    standard_packages: standard,
    special_packages: special,
    fetched_at: new Date().toISOString(),
  };
}
