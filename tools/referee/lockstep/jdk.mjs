// #11370: SeedAgent needs the JDK-internal ASM (removed in JDK 24+). Importing this puts an installed JDK 21/17 first
// on PATH/JAVA_HOME for every javac/java spawned afterwards, so a newer default JDK cannot break the lockstep checks.
import { existsSync } from 'node:fs';
const jdk = ['/usr/lib/jvm/temurin-21-jdk-amd64', '/usr/lib/jvm/temurin-17-jdk-amd64'].find((d) => existsSync(d + '/bin/javac'));
if (jdk) { process.env.JAVA_HOME = jdk; process.env.PATH = jdk + '/bin:' + process.env.PATH; }
export const lockstepJdk = jdk || null;
