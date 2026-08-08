import { Navigate, useLocation, useParams } from "@/lib/router";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

interface LegacyRedirectProps {
  resolve: (params: Readonly<Record<string, string | undefined>>) => string | null;
}

/**
 * Keeps old bookmarks usable while ensuring malformed dynamic parameters never
 * become a literal `undefined` segment in a canonical URL.
 */
const LegacyRedirect = ({ resolve }: LegacyRedirectProps) => {
  const params = useParams<Record<string, string | undefined>>();
  const { hash, search } = useLocation();
  const destination = resolve(params) ?? PRODUCT_ROUTES.landing;

  return <Navigate to={`${destination}${search}${hash}`} replace />;
};

export default LegacyRedirect;
