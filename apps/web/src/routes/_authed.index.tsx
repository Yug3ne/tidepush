import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AuthLayout } from "../components/AuthLayout";
import { getMyOrgs } from "../server/me";

const orgsQuery = queryOptions({ queryKey: ["orgs"], queryFn: () => getMyOrgs() });

export const Route = createFileRoute("/_authed/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(orgsQuery),
  component: Home,
});

function Home() {
  const { viewer } = Route.useRouteContext();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  return (
    <AuthLayout>
      <h1>Hi, {viewer.name}</h1>
      {orgs.length ? (
        <ul>
          {orgs.map((o) => (
            <li key={o.id}>
              {o.name} · {o.role}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lede">You're not in an organization yet.</p>
      )}
    </AuthLayout>
  );
}
