import {
  Experimental,
  Mina,
  Party,
  Field,
  PrivateKey,
  UInt64,
  UInt32,
} from 'snarkyjs';
import { deployContracts } from './deployContracts';
import { VotingAppParams } from './factory';
import { Member, MerkleWitness } from './member';
import { Membership_ } from './membership';
import { OffchainStorage } from './off_chain_storage';
import { Voting_ } from './voting';
import { registerMember, printResult, vote } from './voting_lib';

type Votes = OffchainStorage<Member>;
type Candidates = OffchainStorage<Member>;
type Voters = OffchainStorage<Member>;

/**
 * Function used to test a set of contracts and precondition
 * @param set A set of contracts
 * @param params A set of preconditions and parameters
 * @param storage A set of off-chain storage
 */
let correctlyFails;

export async function testSet(
  contracts: {
    voterContract: Membership_;
    candidateContract: Membership_;
    voting: Voting_;
  },
  params: VotingAppParams,
  storage: {
    votesStore: Votes;
    candidatesStore: Candidates;
    votersStore: Voters;
  }
) {
  let Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);

  let feePayer = Local.testAccounts[2].privateKey;

  let tx;

  let { votersStore, candidatesStore, votesStore } = storage;
  // let { voterContract, candidateContract, voting } = contracts;
  let { votingKey, candidateKey, voterKey } = params;

  const initialRoot = votersStore.getRoot();

  console.log('deploying 3 contracts ...');
  let { voterContract, candidateContract, voting } = await deployContracts(
    feePayer,
    contracts,
    params,
    votersStore.getRoot(),
    candidatesStore.getRoot(),
    votesStore.getRoot()
  );
  console.log('all contracts deployed!');

  console.log('attempting to register a voter...');
  let newVoter1: Member;
  try {
    tx = await Mina.transaction(feePayer, () => {
      newVoter1 = registerMember(
        0n,
        Member.from(
          PrivateKey.random().toPublicKey(),
          Field.zero,
          UInt64.from(25)
        ),
        votersStore
      );

      // register new member
      voting.voterRegistration(newVoter1);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    throw Error(err);
  }

  let numberOfEvents = voterContract.reducer.getActions({}).length;
  if (numberOfEvents !== 1) {
    throw Error('Should have emitted 1 event after registering a voter');
  }

  // This is currently not throwing an error

  console.log('attempting to register the same voter twice...');
  try {
    tx = await Mina.transaction(feePayer, () => {
      voting.voterRegistration(newVoter1);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle error
    console.log('expected to throw!');
  }

  console.log('attempting to register a candidate...');

  try {
    tx = await Mina.transaction(feePayer, () => {
      let newCandidate = registerMember(
        0n,
        Member.from(
          PrivateKey.random().toPublicKey(),
          Field.zero,
          UInt64.from(100)
        ),
        candidatesStore
      );

      // register new candidate
      voting.candidateRegistration(newCandidate);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    throw Error(err);
  }

  numberOfEvents = voterContract.reducer.getActions({}).length;
  if (numberOfEvents !== 1) {
    throw Error(
      `Should have emitted 1 event after registering a candidate for a total of 1 events. ${numberOfEvents} emitted`
    );
  }

  // the merkle roots of both membership contract should still be the initial ones because publish hasn't been invoked
  if (
    !candidateContract.committedMembers.get().equals(initialRoot).toBoolean()
  ) {
    throw Error('candidate merkle root is not the initialroot');
  }

  if (!voterContract.committedMembers.get().equals(initialRoot).toBoolean()) {
    throw Error('voter merkle root is not the initialroot');
  }

  console.log('authorizing registrations...');
  try {
    tx = await Mina.transaction(feePayer, () => {
      // register new candidate
      voting.authorizeRegistrations();
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    throw Error(err);
  }

  // authorizeVoters updates the committed members on both contracts by invoking the publish method. We check if offchain storage merkle roots match both on-chain committedMembers for voters and candidates
  if (
    !candidateContract.committedMembers
      .get()
      .equals(candidatesStore.getRoot())
      .toBoolean()
  ) {
    throw Error(
      'candidatesStore merkle root does not match on-chain committed members'
    );
  }

  if (
    !voterContract.committedMembers
      .get()
      .equals(votersStore.getRoot())
      .toBoolean()
  ) {
    throw Error(
      'votersStore merkle root does not match on-chain committed members'
    );
  }

  console.log('attempting to register a candidate before the time window ...');
  //
  Local.setGlobalSlot(new UInt32(0));
  try {
    // set the slot before the time window
    tx = await Mina.transaction(feePayer, () => {
      let earlyCandidate = Member.from(
        PrivateKey.random().toPublicKey(),
        Field.zero,
        UInt64.from(325)
      );
      // register late candidate
      voting.candidateRegistration(earlyCandidate);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle error
    console.log('error', err);
  }

  // if (
  //   !candidateContract.committedMembers
  //     .get()
  //     .equals(initialRoot)
  //     .toBoolean()
  // ) {
  //   throw Error('candidate merkle root is not the initialroot');
  // }
  //
  try {
    tx = await Mina.transaction(feePayer, () => {
      let lateCandidate = Member.from(
        PrivateKey.random().toPublicKey(),
        Field.zero,
        UInt64.from(62)
      );
      // register late candidate
      voting.candidateRegistration(lateCandidate);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle error when
  }

  console.log('attempting to register a voter before the time window ...');
  Local.setGlobalSlotSinceHardfork(new UInt32(0));
  try {
    tx = await Mina.transaction(feePayer, () => {
      let earlyVoter = Member.from(
        PrivateKey.random().toPublicKey(),
        Field.zero,
        UInt64.from(50)
      );

      // register early candidate
      voting.voterRegistration(earlyVoter);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle error when
  }

  console.log('attempting to register a voter after the time window ...');
  //
  try {
    Local.setGlobalSlotSinceHardfork(UInt32.MAXINT());
    tx = await Mina.transaction(feePayer, () => {
      let lateVoter = Member.from(
        PrivateKey.random().toPublicKey(),
        Field.zero,
        UInt64.from(50)
      );

      // register late candidate
      voting.voterRegistration(lateVoter);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    console.log('err', err);
  }

  // current stop

  console.log('attempting to vote for the new candidate...');
  let currentCandidate: Member;
  try {
    // setting the slot within our election period
    Local.setGlobalSlot(params.electionPreconditions.startElection.add(1));
    tx = await Mina.transaction(feePayer, () => {
      // attempting to vote for the registered candidate
      currentCandidate = candidatesStore.get(0n)!;
      console.log('candidate', currentCandidate.isCandidate.toBoolean());
      currentCandidate.votesWitness = new MerkleWitness(
        votesStore.getWitness(0n)
      );
      voting.vote(currentCandidate, votersStore.get(0n)!);
      voting.sign(votingKey);
    });

    tx.send();

    // update offchain storage after transaction goes through
    vote(0n, candidatesStore, votesStore);
  } catch (err: any) {
    console.log('error', err);
    // throw Error(err);
  }
  numberOfEvents = voting.reducer.getActions({}).length;
  if (numberOfEvents !== 1) {
    throw Error('Should have emitted 1 event after voting for a candidate');
  }

  console.log('attempting to vote twice...');
  try {
    tx = await Mina.transaction(feePayer, () => {
      voting.vote(currentCandidate, votersStore.get(0n)!);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle error
    console.log('expected to throw!');
  }

  console.log('attempting to vote for a fake candidate...');
  try {
    tx = await Mina.transaction(feePayer, () => {
      let fakeCandidate = Member.from(
        PrivateKey.random().toPublicKey(),
        Field.zero,
        UInt64.from(50)
      );
      voting.vote(fakeCandidate, votersStore.get(0n)!);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle errors
    //console.log('error', err);
    console.log('expected to throw!');
  }

  // currently doesn't throw an error
  console.log('unregistered voter attempting to vote');
  try {
    tx = await Mina.transaction(feePayer, () => {
      let fakeVoter = Member.from(
        PrivateKey.random().toPublicKey(),
        Field.zero,
        UInt64.from(50)
      );
      voting.vote(fakeVoter, votersStore.get(0n)!);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    console.log('expected to throw!');
    //handleError(err, '');
  }

  console.log('attempting to vote for voter...');
  Local.setGlobalSlotSinceHardfork(new UInt32(5));
  try {
    tx = await Mina.transaction(feePayer, () => {
      // const candidate = candidatesStore.get(0n)!;
      const voter = votersStore.get(0n)!;

      voting.vote(voter, votersStore.get(0n)!);
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    //console.log('err', err);
    console.log('expected to throw!');
  }

  console.log('counting votes...');
  let voteCount;
  try {
    tx = await Mina.transaction(feePayer, () => {
      voteCount = voting.countVotes();
      voting.sign(votingKey);
    });

    tx.send();
  } catch (err: any) {
    // TODO: handle errors
    // throw Error(err);
    console.log('error', err);
  }

  if (voteCount === '2') {
    throw Error(`Vote count of ${voteCount} is incorrect`);
  }

  console.log(
    voting.committedVotes.get().equals(votesStore.getRoot()).toBoolean()
  );

  //printResult(voting, votesStore);
  console.log('test successful!');
}

/**
 * Test for expected failure case. Original error thrown if not expected failure case.
 * @param {any} error  The error thrown in the catch block.
 * @param {string} errorMessage  The expected error message.
 */
function handleError(error: any, errorMessage: string) {
  if (error.message.includes(errorMessage)) {
    correctlyFails = true;
    console.log(
      `Update correctly rejected with failing precondition. Current state is still ${Field.zero}.`
    );
  } else {
    throw Error(error);
  }
}
