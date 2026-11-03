import type { Profile } from "../src/schema/profile.ts"

/**
 * Version 1 of the interest profile, drawn from the first 48 votes (25 Oct to 3 Nov 2026). The seed inserts it only
 * while `profile_versions` is empty; after that the dashboard's profile page owns it.
 */
export const PROFILE: Profile = {
  text: `I live in Helsinki and read this twice a day to keep up with what matters in the world, in Europe and in Finland.
I work in technology and care about information security, but I do not want vulnerability bulletins. A vulnerability is news to me only when it is exploited at scale, hits software almost everyone runs, or sits behind a real attack.
Give me the big developments: wars and peace talks, elections, diplomacy and sanctions, major disasters and outbreaks, and major cyberattacks, breaches and takedowns.
For Finland I want news that matters to the country: politics, defence, energy, the economy and relations with Russia. Not local incidents, crime or consumer stories.
Foreign news is not Finnish news because a Finnish outlet reported it.`,
  topics: [
    { name: "Russia's war in Ukraine and the peace talks", weight: 3 },
    { name: "European security, defence and NATO", weight: 3 },
    { name: "Finnish politics, defence, energy and economy", weight: 3 },
    { name: "Major cyberattacks, breaches, botnet takedowns and vulnerabilities exploited at scale", weight: 3 },
    { name: "Elections and changes of government in major countries", weight: 2 },
    { name: "US politics and foreign policy", weight: 2 },
    { name: "Middle East conflicts and diplomacy", weight: 2 },
    { name: "Electricity, energy markets and data centres", weight: 2 },
    { name: "AI and the technology industry", weight: 2 },
    { name: "Disasters, outbreaks and accidents with many casualties", weight: 2 },
    { name: "Protests and unrest in Europe", weight: 1 },
    { name: "Sanctions, trade and the global economy", weight: 1 },
    { name: "Historic sports milestones", weight: 1 },
  ],
  follows: { threads: [], entities: [], countries: ["FI"] },
  regions: ["FI", "EU", "SE", "NO", "EE"],
  mutes: [
    "Single-vendor security advisories and patch releases, unless exploited at scale or in software almost everyone runs",
    "Industrial control system advisories",
    "Local crime, accidents and consumer stories with no national significance",
    "Personal stories about politicians and celebrities",
    "Product launches, funding rounds and marketing",
  ],
}
